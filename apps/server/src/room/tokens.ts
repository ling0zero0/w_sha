import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function createRoomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createJoinToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createReconnectToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashReconnectToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function tokenMatches(token: string, expectedHash: Buffer): boolean {
  const actualHash = hashReconnectToken(token);
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}
