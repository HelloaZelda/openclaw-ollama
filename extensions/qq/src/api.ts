import { getQqAccessToken } from "./token.js";

export async function qqApiFetch(params: {
  appId: string;
  clientSecret?: string;
  clientSecretFile?: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}): Promise<{ status: number; text: string; json?: unknown }> {
  const { token } = await getQqAccessToken({
    appId: params.appId,
    clientSecret: params.clientSecret,
    clientSecretFile: params.clientSecretFile,
    signal: params.signal,
  });

  const url = `https://api.sgroup.qq.com${params.path}`;
  const res = await fetch(url, {
    method: params.method,
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
      "X-Union-Appid": params.appId,
    },
    body: params.body != null ? JSON.stringify(params.body) : undefined,
    signal: params.signal,
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    // ignore
  }
  return { status: res.status, text, ...(json !== undefined ? { json } : {}) };
}

export async function sendQqChannelMessage(params: {
  appId: string;
  clientSecret?: string;
  clientSecretFile?: string;
  channelId: string;
  content: string;
  replyToMessageId?: string;
}): Promise<void> {
  const body: Record<string, unknown> = { content: params.content };
  if (params.replyToMessageId?.trim()) {
    body.msg_id = params.replyToMessageId.trim();
  }
  const result = await qqApiFetch({
    appId: params.appId,
    clientSecret: params.clientSecret,
    clientSecretFile: params.clientSecretFile,
    method: "POST",
    path: `/channels/${params.channelId}/messages`,
    body,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`QQ send channel message failed: ${result.status} ${result.text}`);
  }
}

export async function sendQqDmMessage(params: {
  appId: string;
  clientSecret?: string;
  clientSecretFile?: string;
  dmGuildId: string;
  content: string;
  replyToMessageId?: string;
}): Promise<void> {
  const body: Record<string, unknown> = { content: params.content };
  if (params.replyToMessageId?.trim()) {
    body.msg_id = params.replyToMessageId.trim();
  }
  const result = await qqApiFetch({
    appId: params.appId,
    clientSecret: params.clientSecret,
    clientSecretFile: params.clientSecretFile,
    method: "POST",
    path: `/dms/${params.dmGuildId}/messages`,
    body,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`QQ send DM message failed: ${result.status} ${result.text}`);
  }
}
