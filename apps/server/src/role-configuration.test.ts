import { describe, expect, it } from "vitest";
import { countConfiguredRoles, evaluateStartReadiness } from "./role-configuration.js";

describe("role configuration readiness", () => {
  it.each([
    [{ wolf: 1, villager: 1, seer: 1, witch: 0 }, 3],
    [{ wolf: 1, villager: 1, seer: 0, witch: 1 }, 3],
    [{ wolf: 1, villager: 2, seer: 1, witch: 0 }, 4],
    [{ wolf: 1, villager: 1, seer: 0, witch: 0, guard: 1 }, 3],
    [{ wolf: 1, villager: 1, seer: 0, witch: 0, hunter: 1 }, 3],
    [{ wolf: 1, villager: 1, seer: 0, witch: 0, idiot: 1 }, 3]
  ])("accepts a legal composition", (configuration, participantCount) => {
    expect(evaluateStartReadiness(configuration, participantCount)).toMatchObject({
      ready: true,
      configuredRoleCount: participantCount,
      issues: []
    });
  });

  it("returns every blocking issue in deterministic order", () => {
    expect(evaluateStartReadiness({ wolf: 0, villager: 0, seer: 0, witch: 0 }, 3)).toEqual({
      ready: false,
      participantCount: 3,
      configuredRoleCount: 0,
      issues: [
        { code: "WOLF_REQUIRED", message: "至少需要 1 名狼人" },
        { code: "VILLAGER_REQUIRED", message: "至少需要 1 名村民" },
        { code: "GOD_REQUIRED", message: "至少需要 1 名神职" },
        { code: "ROLE_TOTAL_MISMATCH", message: "身份总数 0 必须等于参赛人数 3" }
      ]
    });
  });

  it("reports role totals above and below the participant count", () => {
    expect(evaluateStartReadiness({ wolf: 1, villager: 2, seer: 1, witch: 0 }, 5).issues)
      .toContainEqual(expect.objectContaining({ code: "ROLE_TOTAL_MISMATCH" }));
    expect(evaluateStartReadiness({ wolf: 2, villager: 3, seer: 1, witch: 0 }, 5).issues)
      .toContainEqual(expect.objectContaining({ code: "ROLE_TOTAL_MISMATCH" }));
  });

  it("keeps four-role inputs compatible and includes optional roles in totals", () => {
    expect(countConfiguredRoles({ wolf: 1, villager: 1, seer: 1, witch: 0 })).toBe(3);
    expect(countConfiguredRoles({
      wolf: 1,
      villager: 1,
      seer: 0,
      witch: 0,
      guard: 1,
      hunter: 1,
      idiot: 1
    })).toBe(5);
  });
});
