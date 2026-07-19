import type { ChatMessage } from "@werewolf/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatTimeline, chatMessageText } from "./ChatTimeline";

function textMessage(
  id: string,
  sequence: number,
  text: string,
  nickname = "Alice"
): ChatMessage {
  return {
    id,
    sequence,
    channel: "day-public",
    day: 1,
    phase: "day-speech",
    sender: {
      kind: "player",
      id: "11111111-1111-4111-8111-111111111111",
      number: 1,
      nickname
    },
    content: { kind: "text", text },
    createdAt: "2026-07-19T08:00:00.000Z"
  };
}

describe("ChatTimeline", () => {
  it("renders messages in the order supplied by the merged sequence", () => {
    const html = renderToStaticMarkup(
      <ChatTimeline
        messages={[
          textMessage("22222222-2222-4222-8222-222222222222", 1, "first"),
          textMessage("33333333-3333-4333-8333-333333333333", 2, "second", "Bob")
        ]}
        emptyText="No messages"
      />
    );

    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    expect(html).toContain("1 号 · Alice");
    expect(html).toContain("1 号 · Bob");
    expect(html).not.toContain("No messages");
  });

  it("renders the empty state and formats non-text chat content", () => {
    const emptyHtml = renderToStaticMarkup(
      <ChatTimeline messages={[]} emptyText="No messages yet" className="host-messages" />
    );
    const suggestion: ChatMessage = {
      ...textMessage("44444444-4444-4444-8444-444444444444", 3, "unused"),
      channel: "wolf-private",
      content: {
        kind: "target-suggestion",
        target: {
          id: "55555555-5555-4555-8555-555555555555",
          number: 6,
          nickname: "Carol"
        }
      }
    };

    expect(emptyHtml).toContain("chat-timeline host-messages");
    expect(emptyHtml).toContain("No messages yet");
    expect(chatMessageText(suggestion)).toBe("建议选择 6 号Carol");
    expect(chatMessageText({
      ...suggestion,
      content: { kind: "quick", code: "no-kill" }
    })).toBe("建议空刀");
  });
});
