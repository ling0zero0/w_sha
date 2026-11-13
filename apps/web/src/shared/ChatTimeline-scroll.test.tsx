import type { ChatMessage } from "@werewolf/shared";
import { Children, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  refCursor: 0,
  stateCursor: 0,
  refs: [] as { current: unknown }[],
  states: [] as unknown[],
  effects: [] as (() => void)[],
  timeline: { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, focus: vi.fn() }
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "chat-log",
  useRef(initial: unknown) {
    const index = hooks.refCursor++;
    hooks.refs[index] ??= { current: initial === null ? hooks.timeline : initial };
    return hooks.refs[index];
  },
  useState(initial: unknown) {
    const index = hooks.stateCursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }];
  },
  useEffect(effect: () => void) { hooks.effects.push(effect); }
}));

import { ChatTimeline } from "./ChatTimeline";

const message = (id: string): ChatMessage => ({
  id,
  sequence: Number(id),
  channel: "day-public",
  day: 1,
  phase: "day-speech",
  sender: { kind: "system", label: "系统" },
  content: { kind: "system", text: id },
  createdAt: "2026-11-12T00:00:00.000Z"
});

function render(messages: ChatMessage[], runEffects = true): ReactElement[] {
  hooks.refCursor = 0;
  hooks.stateCursor = 0;
  hooks.effects = [];
  const tree = ChatTimeline({ messages, emptyText: "暂无消息" });
  if (runEffects) {
    for (const effect of hooks.effects) effect();
    return render(messages, false);
  }
  return Children.toArray(tree.props.children) as ReactElement[];
}

function scroll(log: ReactElement) {
  (log.props as { onScroll: () => void }).onScroll();
}

describe("chat history scroll behavior", () => {
  beforeEach(() => {
    hooks.refs = [];
    hooks.states = [];
    Object.assign(hooks.timeline, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
  });

  it("follows the latest message initially and when the reader stays near the bottom", () => {
    let [log] = render([message("1")]);
    expect(hooks.timeline.scrollTop).toBe(1000);
    hooks.timeline.scrollTop = 780;
    scroll(log!);
    hooks.timeline.scrollHeight = 1200;
    const elements = render([message("1"), message("2")]);
    expect(hooks.timeline.scrollTop).toBe(1200);
    expect(elements).toHaveLength(1);
  });

  it("preserves history reading and lets the reader explicitly resume following", () => {
    let [log] = render([message("1")]);
    hooks.timeline.scrollTop = 200;
    scroll(log!);
    hooks.timeline.scrollHeight = 1200;
    const elements = render([message("1"), message("2")]);
    expect(hooks.timeline.scrollTop).toBe(200);
    const button = elements[1]!;
    expect(button.type).toBe("button");
    (button.props as { onClick: () => void }).onClick();
    expect(hooks.timeline.scrollTop).toBe(1200);
    expect(render([message("1"), message("2")])).toHaveLength(1);
    hooks.timeline.scrollHeight = 1400;
    render([message("2"), message("3")]);
    expect(hooks.timeline.scrollTop).toBe(1400);
  });
});
