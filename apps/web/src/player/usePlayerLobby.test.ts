import type { ChatMessage, PlayerLobbyView } from "@werewolf/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  state: undefined as unknown
}));

const socketHarness = vi.hoisted(() => {
  const socket = {
    connected: true,
    disconnect: vi.fn(),
    emit: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      hookHarness.listeners.set(event, listener);
      return socket;
    }
  };
  return { socket };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect(effect: () => void | (() => void)) {
      const cleanup = effect();
      if (cleanup) hookHarness.cleanups.push(cleanup);
    },
    useRef: (initial: unknown) => ({ current: initial }),
    useState(initial: unknown) {
      hookHarness.state = initial;
      return [
        hookHarness.state,
        (next: unknown) => {
          hookHarness.state = typeof next === "function"
            ? (next as (current: unknown) => unknown)(hookHarness.state)
            : next;
        }
      ];
    }
  };
});

vi.mock("socket.io-client", () => ({
  io: () => socketHarness.socket
}));

import { usePlayerLobby } from "./usePlayerLobby";

function message(
  id: string,
  sequence: number,
  text: string,
  channel: ChatMessage["channel"] = "day-public"
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

function lobby(
  messages: ChatMessage[],
  options: {
    phase?: PlayerLobbyView["phase"];
    wolfMessages?: ChatMessage[] | null;
  } = {}
): PlayerLobbyView {
  return {
    phase: options.phase ?? "day-speech",
    publicChat: {
      canSend: true,
      messages
    },
    wolfAction: options.wolfMessages
      ? {
          messages: options.wolfMessages
        }
      : null
  } as PlayerLobbyView;
}

function dispatch(event: string, payload: unknown): void {
  const listener = hookHarness.listeners.get(event);
  if (!listener) throw new Error(`Missing listener for ${event}`);
  listener(payload);
}

function historyCall(index = 0) {
  const calls = socketHarness.socket.emit.mock.calls.filter(([event]) => event === "chat:history");
  const call = calls[index];
  if (!call) throw new Error(`Missing chat:history call ${index}`);
  return call as [
    "chat:history",
    { afterSequence: number; limit: number },
    (result: unknown) => void
  ];
}

describe("usePlayerLobby chat merging", () => {
  beforeEach(() => {
    for (const cleanup of hookHarness.cleanups.splice(0)) cleanup();
    hookHarness.listeners.clear();
    hookHarness.state = undefined;
    socketHarness.socket.disconnect.mockClear();
    socketHarness.socket.emit.mockClear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    });
  });

  it("sorts incoming messages by sequence and ignores duplicate ids", () => {
    usePlayerLobby({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });

    const first = message("22222222-2222-4222-8222-222222222222", 1, "first");
    const second = message("33333333-3333-4333-8333-333333333333", 2, "second");
    const third = message("44444444-4444-4444-8444-444444444444", 3, "third");

    dispatch("player:state", lobby([third, first]));
    dispatch("chat:message", second);

    let current = hookHarness.state as { lobby: PlayerLobbyView };
    expect(current.lobby.publicChat.messages.map((item) => item.sequence)).toEqual([1, 2, 3]);

    dispatch("chat:message", {
      ...second,
      sequence: 4,
      content: { kind: "text", text: "duplicate should be ignored" }
    });

    current = hookHarness.state as { lobby: PlayerLobbyView };
    expect(current.lobby.publicChat.messages).toEqual([first, second, third]);
  });

  it("requests history after the latest visible sequence and merges authorized channels", () => {
    usePlayerLobby({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });

    const publicMessage = message("22222222-2222-4222-8222-222222222222", 2, "public");
    const wolfMessage = message(
      "33333333-3333-4333-8333-333333333333",
      4,
      "wolf",
      "wolf-private"
    );
    dispatch("player:state", lobby([publicMessage], { wolfMessages: [wolfMessage] }));

    const [, request, ack] = historyCall();
    expect(request).toEqual({ afterSequence: 4, limit: 100 });

    const systemMessage: ChatMessage = {
      ...message("44444444-4444-4444-8444-444444444444", 5, "system", "system"),
      sender: { kind: "system", label: "系统" },
      content: { kind: "system", text: "system" }
    };
    const nextWolfMessage = message(
      "55555555-5555-4555-8555-555555555555",
      6,
      "next wolf",
      "wolf-private"
    );
    ack({
      ok: true,
      data: {
        sessionId: "66666666-6666-4666-8666-666666666666",
        messages: [nextWolfMessage, systemMessage],
        latestSequence: 6,
        hasMore: false
      }
    });

    const current = hookHarness.state as { lobby: PlayerLobbyView };
    expect(current.lobby.publicChat.messages.map((item) => item.sequence)).toEqual([2, 5]);
    expect(current.lobby.wolfAction?.messages.map((item) => item.sequence)).toEqual([4, 6]);
  });

  it("loads the complete current-session replay from zero across pages", () => {
    usePlayerLobby({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456"
    });

    const recent = message("22222222-2222-4222-8222-222222222222", 3, "recent");
    dispatch("player:state", lobby([recent], { phase: "game-over" }));

    const [, firstRequest, firstAck] = historyCall();
    expect(firstRequest).toEqual({ afterSequence: 0, limit: 100 });

    const first = message("33333333-3333-4333-8333-333333333333", 1, "first");
    firstAck({
      ok: true,
      data: {
        sessionId: "66666666-6666-4666-8666-666666666666",
        messages: [first],
        latestSequence: 1,
        hasMore: true
      }
    });

    const [, secondRequest, secondAck] = historyCall(1);
    expect(secondRequest).toEqual({ afterSequence: 1, limit: 100 });

    const second = message("44444444-4444-4444-8444-444444444444", 2, "second");
    secondAck({
      ok: true,
      data: {
        sessionId: "66666666-6666-4666-8666-666666666666",
        messages: [second, recent],
        latestSequence: 3,
        hasMore: false
      }
    });

    const current = hookHarness.state as { lobby: PlayerLobbyView };
    expect(current.lobby.publicChat.messages).toEqual([first, second, recent]);
  });
});
