import type { PlayerLobbyView } from "@werewolf/shared";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[]
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useEffect: () => undefined,
    useState(initial: unknown) {
      const index = hookHarness.cursor++;
      if (!(index in hookHarness.states)) {
        hookHarness.states[index] = typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
      }

      return [
        hookHarness.states[index],
        (next: unknown) => {
          hookHarness.states[index] = typeof next === "function"
            ? (next as (current: unknown) => unknown)(hookHarness.states[index])
            : next;
        }
      ];
    }
  };
});

import { DayFlowScreen } from "./DayFlowScreen";

const player = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 1,
  nickname: "Alice",
  connection: "online",
  alive: true
} as const;

const otherPlayer = {
  id: "22222222-2222-4222-8222-222222222222",
  number: 2,
  nickname: "Bob",
  connection: "online",
  alive: true
} as const;

function lobbyWithChat(
  canSend: boolean,
  chatMode: PlayerLobbyView["chatMode"] = "ordered",
  currentSpeaker: typeof player | typeof otherPlayer = player
): PlayerLobbyView {
  return {
    phase: "day-speech",
    players: [player, otherPlayer],
    selfId: player.id,
    chatMode,
    privateRole: null,
    revealedIdiotId: null,
    hunterAction: null,
    dawnResult: null,
    dayVote: null,
    dayState: {
      alivePlayerIds: [player.id, otherPlayer.id],
      revealedIdiot: null,
      hunterPending: false,
      currentSpeaker,
      speechOrder: [player, otherPlayer],
      voteProgress: null,
      voteResult: null
    },
    publicChat: {
      canSend,
      messages: []
    }
  } as unknown as PlayerLobbyView;
}

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

function renderDayFlow(
  lobby: PlayerLobbyView,
  onSendChat = vi.fn()
): ReactElement {
  hookHarness.cursor = 0;
  return DayFlowScreen({
    lobby,
    game: null,
    connected: true,
    onFinishSpeaking: vi.fn(),
    onSendChat,
    onSelectVote: vi.fn(),
    onConfirmVote: vi.fn(),
    onHunterShoot: vi.fn()
  });
}

describe("DayFlowScreen public chat", () => {
  beforeEach(() => {
    hookHarness.cursor = 0;
    hookHarness.states.length = 0;
  });

  it("does not expose the composer when canSend is false", () => {
    const screen = renderDayFlow(lobbyWithChat(false));

    expect(findElement(
      screen,
      (element) => (element.props as { className?: string }).className === "day-chat-form"
    )).toBeUndefined();
  });

  it("trims the sent message and clears the input after submission", () => {
    const onSendChat = vi.fn();
    const lobby = lobbyWithChat(true);
    let screen = renderDayFlow(lobby, onSendChat);
    const textarea = findElement(screen, (element) => element.type === "textarea");

    expect(textarea).toBeDefined();
    (textarea?.props as { onChange: (event: { target: { value: string } }) => void })
      .onChange({ target: { value: "  ready to vote  " } });

    screen = renderDayFlow(lobby, onSendChat);
    const form = findElement(
      screen,
      (element) => (element.props as { className?: string }).className === "day-chat-form"
    );
    const enabledButton = findElement(
      screen,
      (element) => element.type === "button"
        && (element.props as { title?: string }).title === "发送公开发言"
    );

    expect((enabledButton?.props as { disabled?: boolean }).disabled).toBe(false);
    (form?.props as { onSubmit: (event: { preventDefault: () => void }) => void })
      .onSubmit({ preventDefault: vi.fn() });

    expect(onSendChat).toHaveBeenCalledWith({
      channel: "day-public",
      content: { kind: "text", text: "ready to vote" }
    });

    screen = renderDayFlow(lobby, onSendChat);
    const clearedTextarea = findElement(screen, (element) => element.type === "textarea");
    const disabledButton = findElement(
      screen,
      (element) => element.type === "button"
        && (element.props as { title?: string }).title === "发送公开发言"
    );

    expect((clearedTextarea?.props as { value?: string }).value).toBe("");
    expect((disabledButton?.props as { disabled?: boolean }).disabled).toBe(true);
  });

  it("shows the composer to a non-current speaker in open mode without exposing finish speaking", () => {
    const screen = renderDayFlow(lobbyWithChat(true, "open", otherPlayer));

    expect(findElement(
      screen,
      (element) => (element.props as { className?: string }).className === "day-chat-form"
    )).toBeDefined();
    expect(findElement(
      screen,
      (element) => element.type === "button"
        && (element.props as { children?: ReactNode }).children === "结束我的发言"
    )).toBeUndefined();
    expect(findElement(
      screen,
      (element) => typeof element.type === "function"
        && element.type.name === "ChatModeStatus"
        && (element.props as { chatMode?: string }).chatMode === "open"
    )).toBeDefined();
  });

  it("keeps the public player roster visible during the game", () => {
    const screen = renderDayFlow(lobbyWithChat(false));
    const roster = findElement(
      screen,
      (element) => typeof element.type === "function"
        && element.type.name === "PublicPlayerRoster"
    );

    expect(roster).toBeDefined();
    expect((roster?.props as { players?: unknown[] }).players).toHaveLength(2);
  });
});
