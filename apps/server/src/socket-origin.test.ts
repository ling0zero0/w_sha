import { describe, expect, it } from "vitest";
import { createSocketOriginPolicy } from "./socket-origin.js";

describe("Socket origin policy", () => {
  const policy = createSocketOriginPolicy({
    publicAddress: "192.168.1.20",
    publicPort: 5173,
    additionalOrigins: ["https://werewolf.example"]
  });

  it("allows the advertised LAN origin and loopback development origins", () => {
    expect(policy.isAllowed("http://192.168.1.20:5173")).toBe(true);
    expect(policy.isAllowed("http://localhost:5173")).toBe(true);
    expect(policy.isAllowed("http://127.0.0.1:5173")).toBe(true);
    expect(policy.isAllowed("https://werewolf.example")).toBe(true);
    expect(policy.isAllowed(undefined)).toBe(true);
  });

  it("rejects unexpected hosts, ports, schemes, and origin-shaped paths", () => {
    expect(policy.isAllowed("http://192.168.1.21:5173")).toBe(false);
    expect(policy.isAllowed("http://192.168.1.20:3000")).toBe(false);
    expect(policy.isAllowed("ftp://192.168.1.20:5173")).toBe(false);
    expect(policy.isAllowed("http://192.168.1.20:5173/evil")).toBe(false);
    expect(policy.isAllowed("null")).toBe(false);
  });

  it("formats IPv6 LAN addresses as valid origins", () => {
    const ipv6Policy = createSocketOriginPolicy({
      publicAddress: "fe80::20",
      publicPort: 5173
    });

    expect(ipv6Policy.isAllowed("http://[fe80::20]:5173")).toBe(true);
  });
});
