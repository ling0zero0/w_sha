import type { LobbyPlayer } from "@werewolf/shared";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateHarness = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect() {
      return undefined;
    },
    useState(initial: unknown) {
      const index = stateHarness.index++;
      if (!(index in stateHarness.values)) {
        stateHarness.values[index] = typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
      }
      return [
        stateHarness.values[index],
        (next: unknown) => {
          stateHarness.values[index] = typeof next === "function"
            ? (next as (current: unknown) => unknown)(stateHarness.values[index])
            : next;
        }
      ];
    }
  };
});

import { HostBotControls, nextBotNickname } from "./HostBotControls";

const existingBot = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 1,
  nickname: "机器人 1",
  connection: "offline",
  alive: true,
  controller: "bot",
  botKind: "deterministic",
  botProfileId: null
} satisfies LobbyPlayer;

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | undefined {
  if (!isValidElement(node)) return undefined;
  if (predicate(node)) return node;

  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Children.toArray(children)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return undefined;
}

describe("HostBotControls", () => {
  beforeEach(() => {
    stateHarness.values = [];
    stateHarness.index = 0;
  });

  it("chooses the first available convenient nickname", () => {
    expect(nextBotNickname([])).toBe("机器人 1");
    expect(nextBotNickname([
      existingBot,
      { nickname: "机器人 3" }
    ])).toBe("机器人 2");
  });

  it("submits a trimmed deterministic HostAddBotRequest", () => {
    const onAddBot = vi.fn();
    stateHarness.index = 0;
    let controls = HostBotControls({
      players: [existingBot],
      connected: true,
      onAddBot
    });
    const input = findElement(controls, (element) => element.type === "input");

    expect((input?.props as { value?: string }).value).toBe("机器人 2");
    (input?.props as { onChange: (event: { target: { value: string } }) => void })
      .onChange({ target: { value: "  小灰  " } });

    stateHarness.index = 0;
    controls = HostBotControls({
      players: [existingBot],
      connected: true,
      onAddBot
    });
    const form = findElement(
      controls,
      (element) => (element.props as { className?: string }).className === "bot-add-form"
    );
    (form?.props as { onSubmit: (event: { preventDefault: () => void }) => void })
      .onSubmit({ preventDefault: vi.fn() });

    expect(onAddBot).toHaveBeenCalledWith({
      nickname: "小灰",
      botKind: "deterministic"
    });
  });
});
