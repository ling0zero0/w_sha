import { describe, expect, it } from "vitest";
import { getJoinInvitation, getSurface } from "./routing";

describe("surface routing", () => {
  it("uses the host surface by default", () => {
    expect(getSurface("/")).toBe("host");
  });

  it("uses the player surface for join links", () => {
    expect(getSurface("/join/ABC123")).toBe("player");
  });

  it("reads a validated invitation from the URL", () => {
    expect(getJoinInvitation({
      pathname: "/join/123456",
      search: "?t=abcdefghijklmnopqrstuvwxyz123456"
    })).toEqual({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });
  });

  it("rejects incomplete invitation URLs", () => {
    expect(getJoinInvitation({ pathname: "/join/123456", search: "" })).toBeNull();
  });
});
