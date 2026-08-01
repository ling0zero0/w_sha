import type { ChatMessage, HostLobbyView } from "@werewolf/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
  listeners: new Map<string, (...args: unknown[]) => void>(),
  state: undefined as unknown
}));

const socketHarness = vi.hoisted(() => {
  const socket = {
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

vi.mock("@werewolf/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@werewolf/shared")>();
  return {
    ...actual,
    hostBootstrapSchema: {
      parse: (value: unknown) => value
    }
  };
});

import { useHostLobby } from "./useHostLobby";

const actionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function lobby(messages: ChatMessage[], phase: HostLobbyView["phase"] = "day-speech"): HostLobbyView {
  return {
    phase,
    publicChat: {
      canSend: false,
      messages
    }
  } as HostLobbyView;
}

describe("useHostLobby chat history", () => {
  beforeEach(() => {
    for (const cleanup of hookHarness.cleanups.splice(0)) cleanup();
    hookHarness.listeners.clear();
    hookHarness.state = undefined;
    socketHarness.socket.disconnect.mockClear();
    socketHarness.socket.emit.mockClear();
  });

  it("requests an incremental page after the host view cursor and keeps only public channels", async () => {
    const recent = message("22222222-2222-4222-8222-222222222222", 4, "recent");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionToken: "abcdefghijklmnopqrstuvwxyz123456",
        lobby: lobby([recent])
      })
    })));

    useHostLobby();
    await vi.waitFor(() => expect(hookHarness.listeners.has("host:state")).toBe(true));

    const hostState = hookHarness.listeners.get("host:state");
    hostState?.(lobby([recent]));

    const historyCall = socketHarness.socket.emit.mock.calls.find(([event]) => event === "chat:history");
    expect(historyCall?.[1]).toEqual({ afterSequence: 4, limit: 100 });

    const publicMessage = message("33333333-3333-4333-8333-333333333333", 5, "public");
    const privateMessage = message(
      "44444444-4444-4444-8444-444444444444",
      6,
      "private",
      "wolf-private"
    );
    const ack = historyCall?.[2] as ((result: unknown) => void) | undefined;
    ack?.({
      ok: true,
      data: {
        sessionId: "55555555-5555-4555-8555-555555555555",
        messages: [privateMessage, publicMessage],
        latestSequence: 6,
        hasMore: false
      }
    });

    const current = hookHarness.state as { lobby: HostLobbyView };
    expect(current.lobby.publicChat.messages).toEqual([recent, publicMessage]);
  });

  it("emits the selected chat mode through the host event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionToken: "abcdefghijklmnopqrstuvwxyz123456",
        lobby: lobby([])
      })
    })));

    const host = useHostLobby();
    await vi.waitFor(() => expect(hookHarness.listeners.has("host:state")).toBe(true));

    host.updateChatMode("open");

    expect(socketHarness.socket.emit).toHaveBeenCalledWith(
      "host:update-chat-mode",
      expect.objectContaining({
        chatMode: "open",
        actionId: expect.stringMatching(actionIdPattern)
      }),
      expect.any(Function)
    );
  });

  it("emits a shared deterministic add-bot request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sessionToken: "abcdefghijklmnopqrstuvwxyz123456",
        lobby: lobby([], "lobby")
      })
    })));

    const host = useHostLobby();
    await vi.waitFor(() => expect(hookHarness.listeners.has("host:state")).toBe(true));

    host.addBot({
      nickname: "小灰",
      botKind: "deterministic"
    });

    expect(socketHarness.socket.emit).toHaveBeenCalledWith(
      "host:add-bot",
      expect.objectContaining({
        nickname: "小灰",
        botKind: "deterministic",
        actionId: expect.stringMatching(actionIdPattern)
      }),
      expect.any(Function)
    );
  });
});
