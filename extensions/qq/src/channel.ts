import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  type ChannelDock,
  type ChannelPlugin,
  type ChannelOutboundAdapter,
  type ChannelStatusIssue,
  setAccountEnabledInConfigSection,
  type ChannelAccountSnapshot,
} from "openclaw/plugin-sdk";
import {
  listQqAccountIds,
  resolveDefaultQqAccountId,
  resolveQqAccount,
  type ResolvedQqAccount,
} from "./accounts.js";
import { sendQqChannelMessage, sendQqDmMessage } from "./api.js";
import { QqConfigSchema } from "./config-schema.js";
import { startQqMonitor } from "./monitor.js";
import { qqOnboardingAdapter } from "./onboarding.js";
import { normalizeQqTarget, parseQqNormalizedTarget } from "./targets.js";
import { getQqAccessToken } from "./token.js";

const meta = {
  id: "qq",
  label: "QQ Channels",
  selectionLabel: "QQ Channels (Official Bot)",
  detailLabel: "QQ Channels Bot",
  docsPath: "/channels/qq",
  docsLabel: "qq",
  blurb: "QQ Channels bot via Webhook.",
  order: 36,
  quickstartAllowFrom: true,
};

const normalizeAllowEntry = (entry: string) => entry.replace(/^qq:/i, "").trim();

export const qqDock: ChannelDock = {
  id: "qq",
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    media: false,
    threads: false,
    polls: false,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 1800 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveQqAccount({ cfg, accountId }).config.allowFrom ?? []).map((v) => String(v)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => (entry === "*" ? entry : normalizeAllowEntry(entry))),
  },
  groups: {
    resolveRequireMention: ({ cfg }) => cfg.channels?.defaults?.requireMention ?? true,
  },
};

const qqOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunkerMode: "markdown",
  textChunkLimit: 1800,
  resolveTarget: ({ to }) => {
    const normalized = normalizeQqTarget(to);
    if (!normalized) {
      return {
        ok: false,
        error: new Error("Missing QQ target (expected channel:<id> or dm:<id>)"),
      };
    }
    return { ok: true, to: normalized };
  },
  sendText: async (ctx) => {
    const normalized = normalizeQqTarget(ctx.to);
    const parsed = normalized ? parseQqNormalizedTarget(normalized) : null;
    if (!parsed) {
      return { ok: false, error: `Invalid QQ target: ${String(ctx.to ?? "")}` };
    }

    const account = resolveQqAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
    const appId = account.config.appId?.trim() ?? "";
    if (!appId) {
      return { ok: false, error: "QQ appId not configured" };
    }
    const content = ctx.text ?? "";
    if (!content.trim()) {
      return { ok: true };
    }
    try {
      if (parsed.mode === "dm") {
        await sendQqDmMessage({
          appId,
          clientSecret: account.config.clientSecret,
          clientSecretFile: account.config.clientSecretFile,
          dmGuildId: parsed.id,
          content,
        });
      } else {
        await sendQqChannelMessage({
          appId,
          clientSecret: account.config.clientSecret,
          clientSecretFile: account.config.clientSecretFile,
          channelId: parsed.id,
          content,
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

type QqProbe = { ok: true } | { ok: false; error: string };

export const qqPlugin: ChannelPlugin<ResolvedQqAccount, QqProbe> = {
  id: "qq",
  meta,
  onboarding: qqOnboardingAdapter,
  pairing: {
    idLabel: "qqUserId",
    normalizeAllowEntry: normalizeAllowEntry,
    notifyApproval: async () => {
      // QQ DMs require a DM session id to send (dms/{guild_id}/messages). We only notify on-demand.
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.qq"] },
  outbound: qqOutbound,
  configSchema: buildChannelConfigSchema(QqConfigSchema),
  config: {
    listAccountIds: (cfg) => listQqAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveQqAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultQqAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "qq",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "qq",
        accountId,
        clearBaseFields: [
          "appId",
          "clientSecret",
          "clientSecretFile",
          "webhookPath",
          "webhookUrl",
          "name",
        ],
      }),
    isConfigured: (account) => account.tokenSource !== "none",
    describeAccount: (account): ChannelAccountSnapshot => {
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.tokenSource !== "none",
        tokenSource: account.tokenSource,
      };
    },
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveQqAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => (entry === "*" ? entry : normalizeAllowEntry(entry))),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const section = cfg.channels?.qq;
      const useAccountPath =
        Boolean(section && typeof section === "object" && "accounts" in section) &&
        Boolean((section as { accounts?: Record<string, unknown> }).accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.qq.accounts.${resolvedAccountId}.`
        : "channels.qq.";
      const resolved = resolveQqAccount({ cfg, accountId: resolvedAccountId });
      return {
        policy: resolved.config.dmPolicy ?? "pairing",
        allowFrom: resolved.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("qq"),
        normalizeEntry: normalizeAllowEntry,
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const resolved = resolveQqAccount({ cfg, accountId: account.accountId });
      const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
      const groupPolicy = resolved.config.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
      if (groupPolicy === "open") {
        warnings.push(
          `- QQ Channels: groupPolicy="open" allows any channel to trigger (mention-gated). Set channels.qq.groupPolicy="allowlist" and configure channels.qq.groupAllowFrom or channels.qq.groups.`,
        );
      }
      if (resolved.config.dmPolicy === "open") {
        warnings.push(
          `- QQ Channels DMs are open to anyone. Set channels.qq.dmPolicy="pairing" or "allowlist".`,
        );
      }
      return warnings;
    },
  },
  groups: {
    resolveRequireMention: ({ cfg }) => cfg.channels?.defaults?.requireMention ?? true,
  },
  messaging: {
    normalizeTarget: normalizeQqTarget,
    targetResolver: {
      looksLikeId: (_raw, normalized) => {
        const value = (normalized ?? "").trim();
        return Boolean(value) && (/^(channel|dm):/i.test(value) || /^[0-9]+$/.test(value));
      },
      hint: "channel:<channel_id> | dm:<dm_guild_id>",
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) => {
      const issues: ChannelStatusIssue[] = [];
      for (const account of accounts) {
        if (account.configured !== true) {
          issues.push({
            channel: "qq",
            accountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
            kind: "config",
            message: "QQ appId/clientSecret not configured",
          });
        }
      }
      return issues;
    },
    buildChannelSummary: async ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (
        !account.config.appId ||
        (!account.config.clientSecret && !account.config.clientSecretFile)
      ) {
        return { ok: false, error: "QQ appId/clientSecret not configured" };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
      try {
        await getQqAccessToken({
          appId: account.config.appId,
          clientSecret: account.config.clientSecret,
          clientSecretFile: account.config.clientSecretFile,
          signal: controller.signal,
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timeout);
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const configured = account.tokenSource !== "none";
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        tokenSource: account.tokenSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
    logSelfId: ({ account, runtime }) => {
      if (account.config.appId) {
        runtime.log?.(`qq:${String(account.config.appId)}`);
      }
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const { account, log, setStatus, cfg, runtime } = ctx;
      const resolved = resolveQqAccount({ cfg, accountId: account.accountId });
      const { appId, clientSecret, clientSecretFile } = resolved.config;
      if (!appId || (!clientSecret && !clientSecretFile)) {
        throw new Error("QQ appId/clientSecret not configured");
      }

      log?.info(`[${resolved.accountId}] starting QQ Channels webhook`);
      setStatus({ accountId: resolved.accountId, running: true, lastStartAt: Date.now() });

      try {
        const unregister = await startQqMonitor({
          account: resolved,
          cfg,
          runtime,
          statusSink: (patch) => setStatus({ accountId: resolved.accountId, ...patch }),
        });
        ctx.abortSignal.addEventListener(
          "abort",
          () => {
            unregister();
          },
          { once: true },
        );
      } catch (err) {
        setStatus({
          accountId: resolved.accountId,
          running: false,
          lastError: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  },
};
