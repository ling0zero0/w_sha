import type { ChatMessage, GameResult } from "@werewolf/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameOverPanel } from "./GameOverPanel";

function message(
  id: string,
  sequence: number,
  text: string,
  channel: ChatMessage["channel"]
): ChatMessage {
  return {
    id,
    sequence,
    channel,
    day: 1,
    phase: "day-speech",
    sender: {
      kind: "player",
      id: "11111111-1111-4111-8111-111111111111",
      number: 1,
      nickname: "Alice"
    },
    content: { kind: "text", text },
    createdAt: "2026-07-19T08:00:00.000Z"
  };
}

describe("GameOverPanel", () => {
  it("renders the public replay without exposing wolf-private messages", () => {
    const result: NonNullable<GameResult> = {
      outcome: "good-win",
      revealedPlayers: [{
        id: "11111111-1111-4111-8111-111111111111",
        number: 1,
        nickname: "Alice",
        role: "villager",
        alive: true
      }],
      records: []
    };

    const html = renderToStaticMarkup(
      <GameOverPanel
        result={result}
        publicMessages={[
          message("22222222-2222-4222-8222-222222222222", 1, "公开发言", "day-public"),
          message("33333333-3333-4333-8333-333333333333", 2, "狼人私聊", "wolf-private")
        ]}
      />
    );

    expect(html).toContain("公开聊天复盘");
    expect(html).toContain("公开发言");
    expect(html).not.toContain("狼人私聊");
  });
});
