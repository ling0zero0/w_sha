import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AesGcmSecretBox } from "./secret-box.js";

const masterKeyFileName = "ai-master-key";

export function loadOrCreateSecretBox(
  databasePath: string,
  configuredKey?: string
): AesGcmSecretBox {
  if (configuredKey) return AesGcmSecretBox.fromBase64(configuredKey);
  if (databasePath === ":memory:") return new AesGcmSecretBox(randomBytes(32));

  const keyPath = join(dirname(databasePath), masterKeyFileName);
  mkdirSync(dirname(keyPath), { recursive: true });

  try {
    return readSecretBox(keyPath);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const encodedKey = randomBytes(32).toString("base64");
  try {
    writeFileSync(keyPath, encodedKey, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    return AesGcmSecretBox.fromBase64(encodedKey);
  } catch (error) {
    if (isExistingFile(error)) return readSecretBox(keyPath);
    throw error;
  }
}

function readSecretBox(path: string): AesGcmSecretBox {
  return AesGcmSecretBox.fromBase64(readFileSync(path, "utf8").trim());
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isExistingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === "EEXIST";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
