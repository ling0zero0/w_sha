import { beforeEach, describe, expect, it, vi } from "vitest";

const resources = vi.hoisted(() => ({
  snapshotClose: vi.fn(),
  chatClose: vi.fn(),
  auditClose: vi.fn(),
  configClose: vi.fn(),
  integrity: vi.fn(() => true),
  load: vi.fn<() => null>(() => null)
}));

vi.mock("./config.js", () => ({ loadConfig: () => ({ DATABASE_PATH: ":memory:", PUBLIC_ADDRESS: "127.0.0.1" }) }));
vi.mock("./snapshot-store.js", () => ({
  SnapshotStore: class {
    checkIntegrity = resources.integrity;
    load = resources.load;
    close = resources.snapshotClose;
  }
}));
vi.mock("./chat-store.js", () => ({ ChatStore: class { close = resources.chatClose; } }));
vi.mock("./ai/master-key.js", () => ({ loadOrCreateSecretBox: () => ({}) }));
vi.mock("./ai/ai-config-store.js", () => ({ AiConfigStore: class { close = resources.configClose; } }));
vi.mock("./ai/ai-audit-store.js", () => ({ AiAuditStore: class { close = resources.auditClose; } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  resources.integrity.mockReturnValue(true);
  resources.load.mockImplementation(() => null);
});

describe("server startup resource cleanup", () => {
  it.each(["integrity", "snapshot"])("preserves the original %s failure before action ledger initialization", async (failure) => {
    const expected = failure === "integrity" ? "runtime database integrity check failed" : "invalid persisted snapshot";
    if (failure === "integrity") resources.integrity.mockReturnValue(false);
    else resources.load.mockImplementation(() => { throw new Error(expected); });

    await expect(import("./index.js")).rejects.toThrow(expected);
    for (const close of [resources.snapshotClose, resources.chatClose, resources.auditClose, resources.configClose]) {
      expect(close).toHaveBeenCalledOnce();
    }
  });
});
