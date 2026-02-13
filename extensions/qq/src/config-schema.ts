import { MarkdownConfigSchema, ToolPolicySchema } from "openclaw/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);
const toolsBySenderSchema = z.record(z.string(), ToolPolicySchema).optional();

const QqGroupSchema = z
  .object({
    enabled: z.boolean().optional(),
    requireMention: z.boolean().optional(),
    allowFrom: z.array(allowFromEntry).optional(),
    tools: ToolPolicySchema,
    toolsBySender: toolsBySenderSchema,
    systemPrompt: z.string().optional(),
    skills: z.array(z.string()).optional(),
  })
  .strict();

const QqAccountSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    appId: z.string().optional(),
    clientSecret: z.string().optional(),
    clientSecretFile: z.string().optional(),

    // Inbound (Webhook)
    webhookPath: z.string().optional(),
    webhookUrl: z.string().optional(),

    markdown: MarkdownConfigSchema,
    dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
    allowFrom: z.array(allowFromEntry).optional(),
    groupAllowFrom: z.array(allowFromEntry).optional(),
    historyLimit: z.number().optional(),
    dmHistoryLimit: z.number().optional(),
    textChunkLimit: z.number().optional(),
    chunkMode: z.enum(["length", "newline"]).optional(),
    blockStreaming: z.boolean().optional(),
    streaming: z.boolean().optional(),
    mediaMaxMb: z.number().optional(),
    responsePrefix: z.string().optional(),
    groups: z.record(z.string(), QqGroupSchema.optional()).optional(),
  })
  .strict();

export const QqConfigSchema = QqAccountSchema.extend({
  accounts: z.object({}).catchall(QqAccountSchema).optional(),
});
