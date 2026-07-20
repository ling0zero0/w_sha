import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    expect(readFileSync(join(directory, "ai-master-key"), "utf8"))
      .toMatch(/^[A-Za-z0-9+/]{43}=$/);
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
