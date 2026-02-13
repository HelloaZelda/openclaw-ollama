import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createQqEd25519Keys, verifyQqWebhookSignature } from "./webhook-crypto.js";

describe("qq webhook crypto", () => {
  it("verifies signatures generated from the same bot secret", () => {
    const botSecret = "test-secret";
    const timestamp = "1700000000";
    const body = JSON.stringify({ op: 0, t: "AT_MESSAGE_CREATE", d: { content: "hi" } });

    const { privateKey } = createQqEd25519Keys({ botSecret });
    const signed = crypto.sign(null, Buffer.from(`${timestamp}${body}`, "utf-8"), privateKey);
    const signature = signed.toString("hex");

    expect(
      verifyQqWebhookSignature({
        botSecret,
        signature,
        timestamp,
        body,
      }),
    ).toBe(true);
  });
});
