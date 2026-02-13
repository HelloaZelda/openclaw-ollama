import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  DmPolicy,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  normalizeAccountId,
  promptAccountId,
} from "openclaw/plugin-sdk";
import { listQqAccountIds, resolveDefaultQqAccountId, resolveQqAccount } from "./accounts.js";

const channel = "qq" as const;

function setQqDmPolicy(cfg: OpenClawConfig, policy: DmPolicy): OpenClawConfig {
  const allowFrom =
    policy === "open" ? addWildcardAllowFrom(cfg.channels?.qq?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: {
        ...cfg.channels?.qq,
        enabled: true,
        dmPolicy: policy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

async function noteQqSetup(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "Create a QQ Channels (QQ Guild) bot app in the official platform.",
      "Enable Event Subscription (Webhook) and configure the callback URL to your Gateway's public HTTPS endpoint.",
      "Copy the AppID and Client Secret.",
      `Docs: ${formatDocsLink("/channels/qq", "channels/qq")}`,
    ].join("\n"),
    "QQ Channels setup",
  );
}

function normalizeAllowEntry(entry: string): string {
  return entry.replace(/^qq:/i, "").trim();
}

function updateQqConfig(
  cfg: OpenClawConfig,
  accountId: string,
  updates: {
    appId?: string;
    clientSecret?: string;
    webhookPath?: string;
    enabled?: boolean;
  },
): OpenClawConfig {
  const isDefault = accountId === DEFAULT_ACCOUNT_ID;
  const next = { ...cfg } as OpenClawConfig;
  const qq = { ...(next.channels?.qq as Record<string, unknown> | undefined) } as Record<
    string,
    unknown
  >;
  const accounts = qq.accounts ? { ...(qq.accounts as Record<string, unknown>) } : undefined;

  if (isDefault && !accounts) {
    return {
      ...next,
      channels: {
        ...next.channels,
        qq: {
          ...qq,
          ...updates,
          enabled: updates.enabled ?? true,
        },
      },
    };
  }

  const resolvedAccounts = accounts ?? {};
  const existing = (resolvedAccounts[accountId] as Record<string, unknown>) ?? {};
  resolvedAccounts[accountId] = {
    ...existing,
    ...updates,
    enabled: updates.enabled ?? true,
  };

  return {
    ...next,
    channels: {
      ...next.channels,
      qq: {
        ...qq,
        accounts: resolvedAccounts,
      },
    },
  };
}

async function promptQqAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string | null;
}): Promise<OpenClawConfig> {
  const { cfg, prompter } = params;
  const accountId = normalizeAccountId(params.accountId);
  const isDefault = accountId === DEFAULT_ACCOUNT_ID;
  const existingAllowFrom = isDefault
    ? (cfg.channels?.qq?.allowFrom ?? [])
    : (cfg.channels?.qq?.accounts?.[accountId]?.allowFrom ?? []);

  const entry = await prompter.text({
    message: "QQ allowFrom (user id)",
    placeholder: "123456789",
    initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "Required";
      }
      return undefined;
    },
  });

  const parsed = String(entry)
    .split(/[\n,;]+/g)
    .map((item) => normalizeAllowEntry(item))
    .filter(Boolean);
  const merged = [
    ...existingAllowFrom.map((item) => normalizeAllowEntry(String(item))),
    ...parsed,
  ].filter(Boolean);
  const unique = Array.from(new Set(merged));

  if (isDefault) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        qq: {
          ...cfg.channels?.qq,
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: unique,
        },
      },
    };
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      qq: {
        ...cfg.channels?.qq,
        enabled: true,
        accounts: {
          ...cfg.channels?.qq?.accounts,
          [accountId]: {
            ...cfg.channels?.qq?.accounts?.[accountId],
            enabled: cfg.channels?.qq?.accounts?.[accountId]?.enabled ?? true,
            dmPolicy: "allowlist",
            allowFrom: unique,
          },
        },
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "QQ Channels",
  channel,
  policyKey: "channels.qq.dmPolicy",
  allowFromKey: "channels.qq.allowFrom",
  getCurrent: (cfg) => cfg.channels?.qq?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setQqDmPolicy(cfg, policy),
  promptAllowFrom: promptQqAllowFrom,
};

export const qqOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  dmPolicy,
  getStatus: async ({ cfg }) => {
    const configured = listQqAccountIds(cfg).some((id) => {
      const acc = resolveQqAccount({ cfg, accountId: id });
      return acc.tokenSource !== "none";
    });
    return {
      channel,
      configured,
      statusLines: [`QQ Channels: ${configured ? "configured" : "needs app credentials"}`],
      selectionHint: configured ? "configured" : "requires app credentials",
      quickstartScore: configured ? 1 : 10,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    let next = cfg;
    const override = accountOverrides.qq?.trim();
    const defaultId = resolveDefaultQqAccountId(next);
    let accountId = override ? normalizeAccountId(override) : defaultId;

    if (shouldPromptAccountIds && !override) {
      accountId = await promptAccountId({
        cfg: next,
        prompter,
        label: "QQ Channels",
        currentId: accountId,
        listAccountIds: listQqAccountIds,
        defaultAccountId: defaultId,
      });
    }

    await noteQqSetup(prompter);

    const isDefault = accountId === DEFAULT_ACCOUNT_ID;
    const envAppId = process.env.QQBOT_APP_ID?.trim();
    const envSecret = process.env.QQBOT_CLIENT_SECRET?.trim();
    if (isDefault && envAppId && envSecret) {
      const useEnv = await prompter.confirm({
        message: "QQBOT_APP_ID/QQBOT_CLIENT_SECRET detected. Use env vars?",
        initialValue: true,
      });
      if (useEnv) {
        next = updateQqConfig(next, accountId, { enabled: true });
        return { cfg: next, accountId };
      }
    }

    const appId = String(
      await prompter.text({
        message: "QQ AppID",
        placeholder: "123456789012345",
        initialValue: resolveQqAccount({ cfg: next, accountId }).config.appId,
        validate: (value) => (!String(value ?? "").trim() ? "Required" : undefined),
      }),
    ).trim();

    const clientSecret = String(
      await prompter.password({
        message: "QQ Client Secret",
        validate: (value) => (!String(value ?? "").trim() ? "Required" : undefined),
      }),
    ).trim();

    const webhookPath = String(
      await prompter.text({
        message: "Webhook path (Gateway HTTP path)",
        placeholder: "/qq",
        initialValue: resolveQqAccount({ cfg: next, accountId }).config.webhookPath ?? "/qq",
        validate: (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) {
            return "Required";
          }
          if (!raw.startsWith("/")) {
            return "Must start with '/'";
          }
          return undefined;
        },
      }),
    ).trim();

    next = updateQqConfig(next, accountId, {
      enabled: true,
      appId,
      clientSecret,
      webhookPath,
    });

    return { cfg: next, accountId };
  },
};
