import { describe, expect, it } from "vitest";
import { clientPingSchema, serviceStatusSchema } from "./index.js";

describe("shared transport schemas", () => {
  it("accepts the public service status", () => {
    const parsed = serviceStatusSchema.parse({
      name: "werewolf-lan-server",
      version: "0.1.0",
      status: "ok",
      serverTime: "2026-07-15T04:00:00.000Z"
    });

    expect(parsed.status).toBe("ok");
  });

  it("rejects malformed client timestamps", () => {
    expect(() => clientPingSchema.parse({ sentAt: -1 })).toThrow();
  });
});

