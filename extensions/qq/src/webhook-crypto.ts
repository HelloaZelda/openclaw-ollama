import crypto from "node:crypto";

const ED25519_OID_PREFIX_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

function deriveSeed(botSecret: string): Buffer {
  const raw = Buffer.from(botSecret, "utf-8");
  if (raw.length === 0) {
    throw new Error("botSecret is required");
  }
  const seed = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = raw[i % raw.length] ?? 0;
  }
  return seed;
}

function createEd25519PrivateKeyFromSeed(seed: Buffer) {
  if (seed.length !== 32) {
    throw new Error("ed25519 seed must be 32 bytes");
  }
  const pkcs8 = Buffer.concat([ED25519_OID_PREFIX_PKCS8, seed]);
  return crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

export function createQqEd25519Keys(params: { botSecret: string }) {
  const seed = deriveSeed(params.botSecret);
  const privateKey = createEd25519PrivateKeyFromSeed(seed);
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey };
}

function parseSignature(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("empty signature");
  }
  const hexish = /^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0;
  if (hexish) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

export function verifyQqWebhookSignature(params: {
  botSecret: string;
  signature: string;
  timestamp: string;
  body: string;
}): boolean {
  const { publicKey } = createQqEd25519Keys({ botSecret: params.botSecret });
  const signature = parseSignature(params.signature);
  const message = Buffer.from(`${params.timestamp}${params.body}`, "utf-8");
  return crypto.verify(null, message, publicKey, signature);
}

export function signQqValidationResponse(params: {
  botSecret: string;
  eventTs: string;
  plainToken: string;
}): string {
  const { privateKey } = createQqEd25519Keys({ botSecret: params.botSecret });
  const message = Buffer.from(`${params.eventTs}${params.plainToken}`, "utf-8");
  const signature = crypto.sign(null, message, privateKey);
  return signature.toString("hex");
}
