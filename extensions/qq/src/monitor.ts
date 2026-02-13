import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { readFileSync } from "node:fs";
import { createReplyPrefixOptions, type MarkdownTableMode } from "openclaw/plugin-sdk";
import type { ResolvedQqAccount } from "./accounts.js";
import type { QqMessage, QqWebhookPayload, QqWebhookValidationRequest } from "./types.js";
import { sendQqChannelMessage, sendQqDmMessage } from "./api.js";
import { getQqRuntime } from "./runtime.js";
import { normalizeQqTarget, parseQqNormalizedTarget } from "./targets.js";
import { signQqValidationResponse, verifyQqWebhookSignature } from "./webhook-crypto.js";

type QqCoreRuntime = ReturnType<typeof getQqRuntime>;

type WebhookTarget = {
  account: ResolvedQqAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: QqCoreRuntime;
  path: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

const webhookTargets = new Map<string, WebhookTarget[]>();

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "/";
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function resolveWebhookPath(webhookPath?: string, webhookUrl?: string): string | null {
  const trimmedPath = webhookPath?.trim();
  if (trimmedPath) {
    return normalizeWebhookPath(trimmedPath);
  }
  if (webhookUrl?.trim()) {
    try {
      const parsed = new URL(webhookUrl);
      return normalizeWebhookPath(parsed.pathname || "/");
    } catch {
      return null;
    }
  }
  return null;
}

export function registerQqWebhookTarget(target: WebhookTarget): () => void {
  const key = normalizeWebhookPath(target.path);
  const normalizedTarget = { ...target, path: key };
  const existing = webhookTargets.get(key) ?? [];
  webhookTargets.set(key, [...existing, normalizedTarget]);
  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) {
      webhookTargets.set(key, updated);
    } else {
      webhookTargets.delete(key);
    }
  };
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function extractHeader(req: IncomingMessage, key: string): string {
  const raw = req.headers[key.toLowerCase()];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw[0] ?? "";
  }
  return "";
}

export async function handleQqWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalizeWebhookPath(url.pathname);
  const targets = webhookTargets.get(path);
  if (!targets || targets.length === 0) {
    return false;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }

  const appId = extractHeader(req, "x-bot-appid").trim();
  const signature = extractHeader(req, "x-signature-ed25519").trim();
  const timestamp = extractHeader(req, "x-signature-timestamp").trim();
  const agent = extractHeader(req, "user-agent");

  if (!agent.toLowerCase().includes("qqbot-callback")) {
    res.statusCode = 400;
    res.end("invalid user-agent");
    return true;
  }

  const target = targets.find((entry) => entry.account.config.appId?.trim() === appId);
  if (!target) {
    res.statusCode = 404;
    res.end("unknown appid");
    return true;
  }

  let rawBody = "";
  try {
    rawBody = await readRawBody(req, 1024 * 1024);
  } catch (err) {
    res.statusCode = 413;
    res.end(err instanceof Error ? err.message : "payload too large");
    return true;
  }

  const botSecret = target.account.config.clientSecret?.trim() ?? "";
  const botSecretFile = target.account.config.clientSecretFile?.trim() ?? "";
  const effectiveBotSecret =
    botSecret || (botSecretFile ? readFileSync(botSecretFile, "utf-8").trim() : "");
  if (!signature || !timestamp || !effectiveBotSecret) {
    res.statusCode = 401;
    res.end("missing signature headers or bot secret");
    return true;
  }

  const ok = verifyQqWebhookSignature({
    botSecret: effectiveBotSecret,
    signature,
    timestamp,
    body: rawBody,
  });
  if (!ok) {
    res.statusCode = 401;
    res.end("invalid signature");
    return true;
  }

  let payload: QqWebhookPayload | undefined;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as QqWebhookPayload) : undefined;
  } catch {
    res.statusCode = 400;
    res.end("invalid json");
    return true;
  }

  const op = payload?.op;
  if (op === 13) {
    const validation = payload as QqWebhookValidationRequest;
    const plainToken = validation.d?.plain_token?.trim() ?? "";
    const eventTs = validation.d?.event_ts?.trim() ?? "";
    if (!plainToken || !eventTs) {
      res.statusCode = 400;
      res.end("invalid validation payload");
      return true;
    }
    const responseSignature = signQqValidationResponse({
      botSecret: effectiveBotSecret,
      eventTs,
      plainToken,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ plain_token: plainToken, signature: responseSignature }));
    return true;
  }

  // All regular events are handled async; respond quickly.
  res.statusCode = 200;
  res.end("ok");

  target.statusSink?.({ lastInboundAt: Date.now() });
  void processQqWebhookEvent(payload, target).catch((err) => {
    target.runtime.error?.(`[${target.account.accountId}] QQ webhook failed: ${String(err)}`);
  });

  return true;
}

async function processQqWebhookEvent(payload: QqWebhookPayload | undefined, target: WebhookTarget) {
  const eventType = payload?.t?.trim() ?? "";
  if (!eventType) {
    return;
  }

  // QQ Channels: only respond to mention-gated channel messages by default.
  const isChannelMention = eventType === "AT_MESSAGE_CREATE";
  const isDm = eventType === "DIRECT_MESSAGE_CREATE";
  if (!isChannelMention && !isDm) {
    return;
  }

  const message = payload?.d as QqMessage | undefined;
  if (!message || typeof message !== "object") {
    return;
  }

  await processMessageWithPipeline({
    eventType,
    message,
    account: target.account,
    config: target.config,
    runtime: target.runtime,
    core: target.core,
    statusSink: target.statusSink,
  });
}

function normalizeSenderId(raw?: string | null): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed;
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalizedSenderId = normalizeSenderId(senderId);
  return allowFrom.some((entry) => {
    const normalized = String(entry).trim();
    if (!normalized) {
      return false;
    }
    if (normalized === normalizedSenderId) {
      return true;
    }
    if (normalized.replace(/^qq:/i, "") === normalizedSenderId) {
      return true;
    }
    return false;
  });
}

function stripBotMentions(text: string, mentions?: Array<{ id?: string; bot?: boolean }>): string {
  const raw = text ?? "";
  const bots = (mentions ?? []).filter((m) => m?.bot && m.id).map((m) => String(m.id));
  if (bots.length === 0) {
    // Fallback: strip leading mention token if present.
    return raw.replace(/^\s*<@!?[0-9]+>\s*/g, "").trim();
  }
  let out = raw;
  for (const id of bots) {
    const pattern = new RegExp(`^\\\\s*<@!?${id}>\\\\s*`, "g");
    out = out.replace(pattern, "");
  }
  return out.trim();
}

async function processMessageWithPipeline(params: {
  eventType: string;
  message: QqMessage;
  account: ResolvedQqAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: QqCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { eventType, message, account, config, runtime, core } = params;
  const statusSink = params.statusSink;

  const isDm = eventType === "DIRECT_MESSAGE_CREATE";
  const channelId = message.channel_id?.trim() ?? "";
  const guildId = message.guild_id?.trim() ?? "";
  const senderId = message.author?.id?.trim() ?? "";
  const senderName = message.author?.username?.trim() ?? "";

  if (!senderId) {
    return;
  }
  if (message.author?.bot) {
    return;
  }

  const rawBody = stripBotMentions(message.content ?? "", message.mentions).trim();
  if (!rawBody) {
    return;
  }

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const groupPolicy =
    account.config.groupPolicy ?? config.channels?.defaults?.groupPolicy ?? "allowlist";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    isDm && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("qq").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom.map((v) => String(v))];
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = isSenderAllowed(senderId, effectiveAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands },
        ],
      })
    : undefined;

  if (isDm) {
    if (dmPolicy === "disabled") {
      return;
    }

    if (dmPolicy !== "open") {
      if (!senderAllowedForCommands) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "qq",
            id: senderId,
            meta: { name: senderName || undefined },
          });

          if (created) {
            try {
              await deliverQqReply({
                payload: {
                  text: core.channel.pairing.buildPairingReply({
                    channel: "qq",
                    idLine: `Your QQ user id: ${senderId}`,
                    code,
                  }),
                },
                mode: "dm",
                id: guildId,
                account,
                runtime,
                core,
                config,
                replyToMessageId: message.id,
              });
            } catch (err) {
              runtime.error?.(`[${account.accountId}] QQ pairing reply failed: ${String(err)}`);
            }
          }
        }
        return;
      }
    }
  } else {
    if (groupPolicy === "disabled") {
      return;
    }
    const allowFromGroups = (account.config.groupAllowFrom ?? []).map((v) => String(v));
    const groupEntry = account.config.groups?.[channelId];
    const groupEnabled = typeof groupEntry?.enabled === "boolean" ? groupEntry.enabled : undefined;

    if (groupEnabled === false) {
      return;
    }

    if (groupPolicy === "allowlist") {
      const hasExplicit =
        allowFromGroups.length > 0 ||
        Boolean(account.config.groups && Object.keys(account.config.groups).length > 0);
      if (hasExplicit) {
        const allowed =
          allowFromGroups.includes(channelId) ||
          Boolean(groupEntry) ||
          allowFromGroups.includes("*");
        if (!allowed) {
          return;
        }
      } else {
        return;
      }
    }

    const requireMention =
      typeof groupEntry?.requireMention === "boolean" ? groupEntry.requireMention : true;
    if (requireMention && eventType !== "AT_MESSAGE_CREATE") {
      return;
    }
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "qq",
    accountId: account.accountId,
    peer: isDm ? { kind: "dm", id: guildId } : { kind: "group", id: channelId },
    ...(isDm ? {} : { guildId }),
  });

  if (
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    return;
  }

  const fromLabel = isDm
    ? senderName || `user:${senderId}`
    : `guild:${guildId}/channel:${channelId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "QQ",
    from: fromLabel,
    timestamp: message.timestamp ? Date.parse(message.timestamp) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const to = isDm ? `qq:dm:${guildId}` : `qq:channel:${channelId}`;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `qq:${senderId}`,
    To: to,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isDm ? "direct" : "group",
    ConversationLabel: fromLabel,
    SenderName: senderName || undefined,
    SenderId: senderId,
    CommandAuthorized: commandAuthorized,
    Provider: "qq",
    Surface: "qq",
    MessageSid: message.id,
    OriginatingChannel: "qq",
    OriginatingTo: to,
    GroupSpace: !isDm ? guildId : undefined,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`qq: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode: MarkdownTableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "qq",
    accountId: account.accountId,
  });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "qq",
    accountId: account.accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        const normalized = normalizeQqTarget(ctxPayload.To);
        const parsed = normalized ? parseQqNormalizedTarget(normalized) : null;
        const mode = parsed?.mode ?? (isDm ? "dm" : "channel");
        const id = parsed?.id ?? (isDm ? guildId : channelId);
        await deliverQqReply({
          payload,
          mode,
          id,
          account,
          runtime,
          core,
          config,
          replyToMessageId: ctxPayload.MessageSid ?? undefined,
          tableMode,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`[${account.accountId}] QQ ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

async function deliverQqReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  mode: "channel" | "dm";
  id: string;
  account: ResolvedQqAccount;
  runtime: RuntimeEnv;
  core: QqCoreRuntime;
  config: OpenClawConfig;
  replyToMessageId?: string;
  tableMode?: MarkdownTableMode;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, mode, id, account, runtime, core, config, replyToMessageId } = params;
  const tableMode = params.tableMode ?? "code";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);
  if (!text.trim()) {
    return;
  }

  const chunkLimit = account.config.textChunkLimit ?? 1800;
  const chunkMode = core.channel.text.resolveChunkMode(config, "qq", account.accountId);
  const chunks = core.channel.text.chunkMarkdownTextWithMode(text, chunkLimit, chunkMode);

  const appId = account.config.appId?.trim() ?? "";
  if (!appId) {
    throw new Error("QQ appId not configured");
  }
  for (const chunk of chunks) {
    try {
      if (mode === "dm") {
        await sendQqDmMessage({
          appId,
          clientSecret: account.config.clientSecret,
          clientSecretFile: account.config.clientSecretFile,
          dmGuildId: id,
          content: chunk,
          replyToMessageId,
        });
      } else {
        await sendQqChannelMessage({
          appId,
          clientSecret: account.config.clientSecret,
          clientSecretFile: account.config.clientSecretFile,
          channelId: id,
          content: chunk,
          replyToMessageId,
        });
      }
      params.statusSink?.({ lastOutboundAt: Date.now() });
    } catch (err) {
      runtime.error?.(`QQ message send failed: ${String(err)}`);
    }
  }
}

export async function startQqMonitor(params: {
  account: ResolvedQqAccount;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<() => void> {
  const core = getQqRuntime();
  const webhookPath =
    resolveWebhookPath(params.account.config.webhookPath, params.account.config.webhookUrl) ??
    "/qq";
  const unregister = registerQqWebhookTarget({
    account: params.account,
    config: params.cfg,
    runtime: params.runtime,
    core,
    path: webhookPath,
    statusSink: params.statusSink,
  });
  return unregister;
}
