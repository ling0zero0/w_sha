import { describe, expect, it } from "vitest";
import { isAuthorizedAiAdmin } from "./admin-ai-auth.js";

const hostSession = "zyxwvutsrqponmlkjihgfedcba654321";

function request(overrides: Partial<Parameters<typeof isAuthorizedAiAdmin>[0]> = {}) {
  return {
    directAddress: "127.0.0.1",
    origin: "http://127.0.0.1:5173",
    authorization: `Bearer ${hostSession}`,
    ...overrides
  };
}

describe("AI admin authorization", () => {
  it("accepts a loopback browser with the host bearer session", () => {
    expect(isAuthorizedAiAdmin(request(), hostSession)).toBe(true);
  });

  it.each([
    { directAddress: "192.168.1.44" },
    { origin: "http://192.168.1.20:5173" },
    { authorization: "Bearer wrong-session" },
    { authorization: hostSession }
  ])("rejects an invalid boundary: %o", (override) => {
    expect(isAuthorizedAiAdmin(request(override), hostSession)).toBe(false);
  });

  it("rejects missing source and authorization headers", () => {
    expect(isAuthorizedAiAdmin({
      directAddress: "127.0.0.1",
      authorization: `Bearer ${hostSession}`
    }, hostSession)).toBe(false);
    expect(isAuthorizedAiAdmin({
      directAddress: "127.0.0.1",
      origin: "http://127.0.0.1:5173"
    }, hostSession)).toBe(false);
  });

  it("honors the Vite proxy client address only for a loopback proxy", () => {
    expect(isAuthorizedAiAdmin(request({
      proxyClientAddress: "192.168.1.44"
    }), hostSession)).toBe(false);
    expect(isAuthorizedAiAdmin(request({
      directAddress: "192.168.1.44",
      proxyClientAddress: "127.0.0.1"
    }), hostSession)).toBe(false);
  });
});
