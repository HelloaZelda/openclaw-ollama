import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";

export type ResolvedQqAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  tokenSource: "app" | "none";
  config: {
    appId?: string;
    clientSecret?: string;
    clientSecretFile?: string;
    webhookPath?: string;
    webhookUrl?: string;
    dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
    groupPolicy?: "open" | "allowlist" | "disabled";
    allowFrom?: Array<string | number>;
    groupAllowFrom?: Array<string | number>;
    groups?: Record<
      string,
      | {
          enabled?: boolean;
          requireMention?: boolean;
          allowFrom?: Array<string | number>;
          systemPrompt?: string;
          tools?: unknown;
          toolsBySender?: Record<string, unknown>;
          skills?: string[];
        }
      | undefined
    >;
    textChunkLimit?: number;
    chunkMode?: "length" | "newline";
    mediaMaxMb?: number;
  };
};

type QqConfigRoot = {
  enabled?: boolean;
  name?: string;
  appId?: string;
  clientSecret?: string;
  clientSecretFile?: string;
  webhookPath?: string;
  webhookUrl?: string;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, unknown>;
  accounts?: Record<string, Record<string, unknown> | undefined>;
  textChunkLimit?: number;
  chunkMode?: "length" | "newline";
  mediaMaxMb?: number;
};

function readQqRoot(cfg: OpenClawConfig): QqConfigRoot {
  return (cfg.channels?.qq ?? {}) as QqConfigRoot;
}

export function listQqAccountIds(cfg: OpenClawConfig): string[] {
  const root = readQqRoot(cfg);
  const ids = Object.keys(root.accounts ?? {}).map((id) => normalizeAccountId(id));
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return Array.from(new Set([DEFAULT_ACCOUNT_ID, ...ids]));
}

export function resolveDefaultQqAccountId(cfg: OpenClawConfig): string {
  const root = readQqRoot(cfg);
  const accounts = root.accounts ?? {};
  if (accounts[DEFAULT_ACCOUNT_ID]) {
    return DEFAULT_ACCOUNT_ID;
  }
  const first = Object.keys(accounts)[0];
  return normalizeAccountId(first ?? DEFAULT_ACCOUNT_ID);
}

export function resolveQqAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedQqAccount {
  const accountId = normalizeAccountId(params.accountId);
  const root = readQqRoot(params.cfg);
  const rawAccount = root.accounts?.[accountId] ?? {};
  const useTopLevel = accountId === DEFAULT_ACCOUNT_ID && !root.accounts?.[DEFAULT_ACCOUNT_ID];
  const merged = useTopLevel ? (root as Record<string, unknown>) : rawAccount;

  const appId = typeof merged.appId === "string" ? merged.appId : undefined;
  const clientSecret = typeof merged.clientSecret === "string" ? merged.clientSecret : undefined;
  const clientSecretFile =
    typeof merged.clientSecretFile === "string" ? merged.clientSecretFile : undefined;
  const enabledValue = typeof merged.enabled === "boolean" ? merged.enabled : undefined;
  const enabled = enabledValue ?? (useTopLevel ? root.enabled !== false : true);
  const name = typeof merged.name === "string" ? merged.name : undefined;
  const tokenSource = appId && (clientSecret || clientSecretFile) ? "app" : "none";

  return {
    accountId,
    enabled,
    name,
    tokenSource,
    config: {
      appId,
      clientSecret,
      clientSecretFile,
      webhookPath: typeof merged.webhookPath === "string" ? merged.webhookPath : undefined,
      webhookUrl: typeof merged.webhookUrl === "string" ? merged.webhookUrl : undefined,
      dmPolicy: merged.dmPolicy as ResolvedQqAccount["config"]["dmPolicy"],
      groupPolicy: merged.groupPolicy as ResolvedQqAccount["config"]["groupPolicy"],
      allowFrom: Array.isArray(merged.allowFrom)
        ? (merged.allowFrom as Array<string | number>)
        : [],
      groupAllowFrom: Array.isArray(merged.groupAllowFrom)
        ? (merged.groupAllowFrom as Array<string | number>)
        : [],
      groups:
        merged.groups && typeof merged.groups === "object"
          ? (merged.groups as ResolvedQqAccount["config"]["groups"])
          : undefined,
      textChunkLimit: typeof merged.textChunkLimit === "number" ? merged.textChunkLimit : undefined,
      chunkMode: merged.chunkMode as ResolvedQqAccount["config"]["chunkMode"],
      mediaMaxMb: typeof merged.mediaMaxMb === "number" ? merged.mediaMaxMb : undefined,
    },
  };
}
