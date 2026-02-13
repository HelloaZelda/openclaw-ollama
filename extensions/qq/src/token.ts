import { readFileSync } from "node:fs";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  message?: string;
};

type TokenCache = {
  value: string;
  expiresAtMs: number;
};

const tokenCache = new Map<string, TokenCache>();

function buildCacheKey(appId: string, secret: string): string {
  return `${appId}:${secret.slice(0, 6)}`;
}

export async function getQqAccessToken(params: {
  appId: string;
  clientSecret?: string;
  clientSecretFile?: string;
  signal?: AbortSignal;
}): Promise<{ token: string; expiresAtMs: number }> {
  const appId = params.appId.trim();
  const clientSecret =
    params.clientSecret?.trim() ||
    (params.clientSecretFile?.trim()
      ? readFileSync(params.clientSecretFile.trim(), "utf-8").trim()
      : "");
  if (!appId) {
    throw new Error("QQ appId is required");
  }
  if (!clientSecret) {
    throw new Error("QQ clientSecret is required");
  }

  const key = buildCacheKey(appId, clientSecret);
  const cached = tokenCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAtMs - 60_000 > now) {
    return { token: cached.value, expiresAtMs: cached.expiresAtMs };
  }

  const response = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
    signal: params.signal,
  });

  const text = await response.text();
  let parsed: TokenResponse = {};
  try {
    parsed = text ? (JSON.parse(text) as TokenResponse) : {};
  } catch {
    // ignore
  }

  if (!response.ok) {
    throw new Error(`QQ token request failed: ${response.status} ${parsed.message ?? text}`);
  }

  const token = parsed.access_token?.trim() ?? "";
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 0;
  if (!token) {
    throw new Error(`QQ token response missing access_token: ${text}`);
  }
  const expiresAtMs = now + Math.max(0, expiresIn) * 1000;
  tokenCache.set(key, { value: token, expiresAtMs });
  return { token, expiresAtMs };
}
