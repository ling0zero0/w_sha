import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretBox } from "./secret-box.js";

describe("AES-GCM AI secret box", () => {
  it("round-trips credentials without deterministic ciphertext", () => {
    const box = new AesGcmSecretBox(randomBytes(32));
    const first = box.seal("provider:alpha:api-key", "secret-value");
    const second = box.seal("provider:alpha:api-key", "secret-value");

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.nonce).not.toBe(second.nonce);
    expect(box.open("provider:alpha:api-key", first)).toBe("secret-value");
    expect(box.open("provider:alpha:api-key", second)).toBe("secret-value");
  });

  it("binds ciphertext to its purpose, key and authentication tag", () => {
    const box = new AesGcmSecretBox(randomBytes(32));
    const otherBox = new AesGcmSecretBox(randomBytes(32));
    const encrypted = box.seal("provider:alpha:api-key", "secret-value");

    expect(() => box.open("provider:beta:api-key", encrypted)).toThrow(
      "could not decrypt AI credential"
    );
    expect(() => otherBox.open("provider:alpha:api-key", encrypted)).toThrow(
      "could not decrypt AI credential"
    );
    expect(() => box.open("provider:alpha:api-key", {
      ...encrypted,
      authTag: Buffer.alloc(16).toString("base64")
    })).toThrow("could not decrypt AI credential");
  });

  it("rejects invalid master key material and versions", () => {
    expect(() => new AesGcmSecretBox(randomBytes(31))).toThrow(
      "AI master key must contain exactly 32 bytes"
    );
    expect(() => new AesGcmSecretBox(randomBytes(32), 0)).toThrow(
      "AI master key version must be a positive integer"
    );
    expect(() => AesGcmSecretBox.fromBase64("not canonical base64")).toThrow(
      "AI master key must be canonical base64"
    );
  });
});
