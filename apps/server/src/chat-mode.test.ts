import type { PlayerId } from "@werewolf/shared";
import { describe, expect, it } from "vitest";
import { LobbyRoom, type LobbyRoomSnapshot } from "./room.js";

const token = "abcdefghijklmnopqrstuvwxyz123456";

function createStartedSnapshot(chatMode: "ordered" | "open"): {
  snapshot: LobbyRoomSnapshot;
  playerIds: PlayerId[];
} {
  const room = new LobbyRoom({
    localAddress: "192.168.1.20",
    webPort: 5173,
    roomCode: "123456",
    joinToken: token
  });
  const sessions = ["Player 1", "Player 2", "Player 3"].map((nickname, index) =>
    room.join({ roomCode: "123456", joinToken: token, nickname }, `socket-${index}`)
  );
  if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
  expect(room.updateChatMode(chatMode)).toMatchObject({ ok: true });
  room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
  expect(room.startGame(new Date("2026-07-19T08:00:00.000Z"))).toMatchObject({ ok: true });

  return {
    snapshot: room.createSnapshot(),
    playerIds: sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return session.data.lobby.selfId;
    })
  };
}

function restoreAtSpeech(
  chatMode: "ordered" | "open",
  phase: "day-speech" | "last-words" = "day-speech",
  mutate?: (snapshot: LobbyRoomSnapshot, playerIds: PlayerId[]) => void
): { room: LobbyRoom; playerIds: PlayerId[] } {
  const { snapshot, playerIds } = createStartedSnapshot(chatMode);
  snapshot.phase = phase;
  snapshot.speechOrderIds = [...playerIds];
  snapshot.currentSpeakerIndex = 0;
  snapshot.currentSpeakerFinished = false;
  mutate?.(snapshot, playerIds);
  return {
    room: new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      snapshot
    }),
    playerIds
  };
}

describe("discussion chat modes", () => {
  it("defaults legacy snapshots and both lobby views to ordered", () => {
    const { snapshot, playerIds } = createStartedSnapshot("open");
    delete snapshot.chatMode;
    const room = new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      snapshot
    });

    expect(room.getHostView().chatMode).toBe("ordered");
    expect(room.getPlayerView(playerIds[0]!)?.chatMode).toBe("ordered");
    expect(room.createSnapshot().chatMode).toBe("ordered");
  });

  it("allows chat mode updates only in the lobby", () => {
    const room = new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: token
    });
    expect(room.updateChatMode("open")).toMatchObject({
      ok: true,
      data: { chatMode: "open" }
    });

    const { snapshot } = createStartedSnapshot("ordered");
    const started = new LobbyRoom({
      localAddress: "192.168.1.20",
      webPort: 5173,
      snapshot
    });
    expect(started.updateChatMode("open")).toMatchObject({
      ok: false,
      code: "GAME_ALREADY_STARTED"
    });
  });

  it("keeps ordered day speech limited to the current speaker", () => {
    const { room, playerIds } = restoreAtSpeech("ordered");

    expect(room.getPlayerView(playerIds[0]!)?.publicChat.canSend).toBe(true);
    expect(room.getPlayerView(playerIds[1]!)?.publicChat.canSend).toBe(false);
    expect(room.sendChat(
      playerIds[1]!,
      { channel: "day-public", content: { kind: "text", text: "out of order" } }
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
  });

  it("allows every living non-departed player during open day speech", () => {
    const { room, playerIds } = restoreAtSpeech("open");

    expect(playerIds.map((playerId) =>
      room.getPlayerView(playerId)?.publicChat.canSend
    )).toEqual([true, true, true]);
    expect(room.sendChat(
      playerIds[1]!,
      { channel: "day-public", content: { kind: "text", text: "open discussion" } },
      new Date("2026-07-19T08:00:01.000Z")
    )).toMatchObject({ ok: true, data: { channel: "day-public" } });
  });

  it("rejects dead and departed players during open day speech", () => {
    const dead = restoreAtSpeech("open", "day-speech", (snapshot) => {
      snapshot.players[2]!.alive = false;
    });
    expect(dead.room.getPlayerView(dead.playerIds[2]!)?.publicChat.canSend).toBe(false);
    expect(dead.room.sendChat(
      dead.playerIds[2]!,
      { channel: "day-public", content: { kind: "text", text: "dead player" } }
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });

    const departed = restoreAtSpeech("open", "day-speech", (snapshot) => {
      snapshot.players[1]!.connection = "departed";
    });
    expect(departed.room.getPlayerView(departed.playerIds[1]!)?.publicChat.canSend).toBe(false);
    expect(departed.room.sendChat(
      departed.playerIds[1]!,
      { channel: "day-public", content: { kind: "text", text: "departed player" } }
    )).toMatchObject({ ok: false, code: "PLAYER_NOT_FOUND" });
  });

  it("keeps last words limited to the current speaker in open mode", () => {
    const { room, playerIds } = restoreAtSpeech("open", "last-words", (snapshot) => {
      snapshot.players[0]!.alive = false;
    });

    expect(room.getPlayerView(playerIds[0]!)?.publicChat.canSend).toBe(true);
    expect(room.getPlayerView(playerIds[1]!)?.publicChat.canSend).toBe(false);
    expect(room.sendChat(
      playerIds[0]!,
      { channel: "day-public", content: { kind: "text", text: "last words" } },
      new Date("2026-07-19T08:00:01.000Z")
    )).toMatchObject({ ok: true });
    expect(room.sendChat(
      playerIds[1]!,
      { channel: "day-public", content: { kind: "text", text: "interruption" } },
      new Date("2026-07-19T08:00:02.000Z")
    )).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
  });
});
