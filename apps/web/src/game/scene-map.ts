import type { GameResult, RoomPhase } from "@werewolf/shared";

/** 每个阶段对应的村庄场景：同一座广场在月夜、深夜、破晓、白天与结局下的不同光线。 */
const sceneKeys = ["waiting-hall", "deep-night", "dawn-village", "day-square", "good-victory", "wolf-victory"] as const;
export type SceneKey = (typeof sceneKeys)[number];
export type SceneOutcome = NonNullable<GameResult>["outcome"];

/** 阶段叙事：给公共屏幕一句法官口吻的提示，不参与任何断言。 */
const narrations: Record<RoomPhase, string> = {
  lobby: "夜色将至，静候村民入座",
  "role-reveal": "身份已定，请各自谨记",
  "first-night": "天黑请闭眼",
  dawn: "天亮了，村庄重新苏醒",
  "last-words": "请留下最后的话语",
  "day-speech": "众人齐聚广场，轮流陈述",
  "day-vote": "指认你心中的狼人",
  "exile-result": "裁决已定，村庄重归寂静",
  "game-over": "这一夜，终有结局"
};

export function sceneNarration(phase: RoomPhase | null | undefined): string {
  return phase ? narrations[phase] : narrations.lobby;
}

export function sceneForPhase(phase: RoomPhase | null | undefined, outcome?: SceneOutcome | null): SceneKey {
  if (phase === "game-over") {
    if (outcome === "wolf-win") return "wolf-victory";
    if (outcome === "good-win") return "good-victory";
    if (outcome === "terminated") return "deep-night";
    return "dawn-village";
  }

  switch (phase) {
    case "role-reveal":
    case "first-night":
      return "deep-night";
    case "dawn":
      return "dawn-village";
    case "last-words":
    case "day-speech":
    case "day-vote":
    case "exile-result":
      return "day-square";
    case "lobby":
    default:
      return "waiting-hall";
  }
}
