import { describe, expect, it } from "vitest";
import type { Role } from "@werewolf/shared";
import { evaluateGameOutcome, resolveNightDeaths, resolvePlurality, resolveWolfAttack } from "./rules.js";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const thirdId = "00000000-0000-4000-8000-000000000003";

describe("game rules", () => {
  it("resolves a unique plurality and leaves ties unresolved", () => {
    expect(resolvePlurality([firstId, secondId, firstId])).toBe(firstId);
    expect(resolvePlurality([firstId, secondId])).toBeNull();
    expect(resolvePlurality([])).toBeNull();
  });

  it("treats no-kill and tied wolf votes as no attack", () => {
    expect(resolveWolfAttack([firstId, firstId, secondId])).toBe(firstId);
    expect(resolveWolfAttack([firstId, secondId])).toBeNull();
    expect(resolveWolfAttack(["no-kill", "no-kill", firstId])).toBeNull();
  });

  it("deduplicates and orders night deaths by player number", () => {
    const players = [
      { id: firstId, number: 2 },
      { id: secondId, number: 1 },
      { id: thirdId, number: 3 }
    ];

    expect(resolveNightDeaths(players, firstId, false, secondId)).toEqual([secondId, firstId]);
    expect(resolveNightDeaths(players, firstId, true, secondId)).toEqual([secondId]);
    expect(resolveNightDeaths(players, firstId, false, firstId)).toEqual([firstId]);
    expect(resolveNightDeaths(players, firstId, false, null, firstId)).toEqual([]);
    expect(resolveNightDeaths(players, firstId, false, firstId, firstId)).toEqual([firstId]);
  });

  it("evaluates the existing edge-elimination win conditions", () => {
    const player = (role: Role, alive = true) => ({
      role,
      alive,
      connection: "online" as const
    });

    expect(evaluateGameOutcome([player("villager"), player("seer")])).toBe("good-win");
    expect(evaluateGameOutcome([player("wolf"), player("seer")])).toBe("wolf-win");
    expect(evaluateGameOutcome([player("wolf"), player("villager"), player("seer")])).toBeNull();
    expect(evaluateGameOutcome([player("wolf", false), player("villager", false)])).toBe("draw");
  });

  it.each(["guard", "hunter", "idiot"] as const)("counts %s as a god role", (role) => {
    const player = (candidateRole: Role, alive = true) => ({
      role: candidateRole,
      alive,
      connection: "online" as const
    });

    expect(evaluateGameOutcome([player("wolf"), player("villager"), player(role)])).toBeNull();
    expect(evaluateGameOutcome([player("wolf"), player("villager"), player(role, false)])).toBe("wolf-win");
  });

  it("returns a draw when the final wolf and final god are eliminated together", () => {
    const player = (role: Role, alive: boolean) => ({
      role,
      alive,
      connection: "online" as const
    });

    expect(evaluateGameOutcome([
      player("wolf", false),
      player("villager", true),
      player("hunter", false)
    ])).toBe("draw");
  });
});
