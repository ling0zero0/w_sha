import { describe, expect, it } from "vitest";
import { getSurface } from "./routing";

describe("surface routing", () => {
  it("uses the host surface by default", () => {
    expect(getSurface("/")).toBe("host");
  });

  it("uses the player surface for join links", () => {
    expect(getSurface("/join/ABC123")).toBe("player");
  });
});

