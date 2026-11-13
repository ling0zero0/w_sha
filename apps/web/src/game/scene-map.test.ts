import { describe, expect, it } from "vitest";
import { sceneForPhase, sceneNarration, type SceneKey } from "./scene-map";

describe("sceneForPhase", () => {
  it("uses the lit village while waiting in the lobby", () => {
    expect(sceneForPhase("lobby")).toBe<SceneKey>("waiting-hall");
    expect(sceneForPhase(null)).toBe<SceneKey>("waiting-hall");
  });

  it("darkens the village for night phases and lifts it at dawn", () => {
    expect(sceneForPhase("role-reveal")).toBe<SceneKey>("deep-night");
    expect(sceneForPhase("first-night")).toBe<SceneKey>("deep-night");
    expect(sceneForPhase("dawn")).toBe<SceneKey>("dawn-village");
  });

  it("moves to the day square for public discussion and voting", () => {
    for (const phase of ["last-words", "day-speech", "day-vote", "exile-result"] as const) {
      expect(sceneForPhase(phase), phase).toBe<SceneKey>("day-square");
    }
  });

  it("gives every phase an in-world narration line", () => {
    expect(sceneNarration("first-night")).toBe("天黑请闭眼");
    expect(sceneNarration("dawn")).toBe("天亮了，村庄重新苏醒");
    expect(sceneNarration(null)).toBe("夜色将至，静候村民入座");
  });

  it("shows the matching ending artwork for each outcome", () => {
    expect(sceneForPhase("game-over", "good-win")).toBe<SceneKey>("good-victory");
    expect(sceneForPhase("game-over", "wolf-win")).toBe<SceneKey>("wolf-victory");
    expect(sceneForPhase("game-over", "terminated")).toBe<SceneKey>("deep-night");
    expect(sceneForPhase("game-over", "draw")).toBe<SceneKey>("dawn-village");
    expect(sceneForPhase("game-over", null)).toBe<SceneKey>("dawn-village");
  });
});
