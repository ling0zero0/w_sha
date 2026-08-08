import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { AesGcmSecretBox } from "./secret-box.js";
import { protectForCurrentWindowsUser, unprotectForCurrentWindowsUser } from "./windows-dpapi.js";

const masterKeyFileName = "ai-master-key";
const windowsDpapiPrefix = "dpapi:v1:";

interface StoredMasterKey {
  box: AesGcmSecretBox;
  encodedKey: string;
  protectedAtRest: boolean;
}

export function loadOrCreateSecretBox(
  databasePath: string,
  configuredKey?: string
): AesGcmSecretBox {
  if (configuredKey) return AesGcmSecretBox.fromBase64(configuredKey);
  if (databasePath === ":memory:") return new AesGcmSecretBox(randomBytes(32));

  const keyPath = join(dirname(databasePath), masterKeyFileName);
  mkdirSync(dirname(keyPath), { recursive: true });

  try {
    const stored = readSecretBox(keyPath);
    if (isWindows() && !stored.protectedAtRest) {
      replaceStoredKey(keyPath, stored.encodedKey);
    }
    return stored.box;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const encodedKey = randomBytes(32).toString("base64");
  try {
    writeStoredKey(keyPath, encodedKey);
    return AesGcmSecretBox.fromBase64(encodedKey);
  } catch (error) {
    if (isExistingFile(error)) {
      const stored = readSecretBox(keyPath);
      if (isWindows() && !stored.protectedAtRest) replaceStoredKey(keyPath, stored.encodedKey);
      return stored.box;
    }
    throw error;
  }
}

function readSecretBox(path: string): StoredMasterKey {
  const storedValue = readFileSync(path, "utf8").trim();
  const protectedAtRest = storedValue.startsWith(windowsDpapiPrefix);
  if (protectedAtRest && !isWindows()) {
    throw new Error("Windows DPAPI protected master key requires Windows");
  }
  const encodedKey = protectedAtRest
    ? unprotectForCurrentWindowsUser(storedValue.slice(windowsDpapiPrefix.length))
    : storedValue;
  return {
    box: AesGcmSecretBox.fromBase64(encodedKey),
    encodedKey,
    protectedAtRest
  };
}

function writeStoredKey(path: string, encodedKey: string): void {
  writeFileSync(path, formatStoredKey(encodedKey), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

function replaceStoredKey(path: string, encodedKey: string): void {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, formatStoredKey(encodedKey), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  try {
    try {
      renameSync(temporaryPath, path);
    } catch (error) {
      try {
        copyFileSync(temporaryPath, path);
        unlinkSync(temporaryPath);
      } catch {
        throw error;
      }
    }
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}

function formatStoredKey(encodedKey: string): string {
  return isWindows()
    ? `${windowsDpapiPrefix}${protectForCurrentWindowsUser(encodedKey)}`
    : encodedKey;
}

function isWindows(): boolean {
  return process.platform === "win32";
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
