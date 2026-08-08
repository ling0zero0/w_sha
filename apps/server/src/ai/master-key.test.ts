import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateSecretBox } from "./master-key.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("loadOrCreateSecretBox", () => {
  it("creates and reuses a master key next to the database", () => {
    const directory = createTemporaryDirectory();
    const databasePath = join(directory, "werewolf.sqlite");
    const first = loadOrCreateSecretBox(databasePath);
    const encrypted = first.seal("provider:test", "secret-value");

    const second = loadOrCreateSecretBox(databasePath);

    expect(second.open("provider:test", encrypted)).toBe("secret-value");
    const storedKey = readFileSync(join(directory, "ai-master-key"), "utf8");
    if (process.platform === "win32") {
      expect(storedKey).toMatch(/^dpapi:v1:[A-Za-z0-9+/]+=*$/);
    } else {
      expect(storedKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    }
  });

  it.runIf(process.platform === "win32")("migrates a legacy plaintext key to DPAPI", () => {
    const directory = createTemporaryDirectory();
    const databasePath = join(directory, "werewolf.sqlite");
    const encodedKey = randomBytes(32).toString("base64");
    writeFileSync(join(directory, "ai-master-key"), encodedKey, "utf8");

    const box = loadOrCreateSecretBox(databasePath);

    expect(box.open("provider:test", box.seal("provider:test", "secret-value"))).toBe("secret-value");
    const storedKey = readFileSync(join(directory, "ai-master-key"), "utf8");
    expect(storedKey.startsWith("dpapi:v1:")).toBe(true);
    expect(storedKey).not.toBe(encodedKey);
  });

  it("prefers an explicitly configured key", () => {
    const configuredKey = randomBytes(32).toString("base64");
    const first = loadOrCreateSecretBox(":memory:", configuredKey);
    const encrypted = first.seal("provider:test", "secret-value");

    const second = loadOrCreateSecretBox(":memory:", configuredKey);

    expect(second.open("provider:test", encrypted)).toBe("secret-value");
  });

  it("uses an ephemeral key for an in-memory database", () => {
    const box = loadOrCreateSecretBox(":memory:");
    const encrypted = box.seal("provider:test", "secret-value");

    expect(box.open("provider:test", encrypted)).toBe("secret-value");
  });
});

function createTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "werewolf-master-key-"));
  temporaryDirectories.push(path);
  return path;
}
