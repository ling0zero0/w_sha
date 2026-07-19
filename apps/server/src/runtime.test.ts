import { afterEach, describe, expect, it } from "vitest";
import { ChatStore } from "./chat-store.js";
import { GameRuntime, type GameRuntimeSnapshot } from "./runtime.js";

const chatStores: ChatStore[] = [];

afterEach(() => {
  for (const store of chatStores.splice(0)) store.close();
});

function createChatStore(): ChatStore {
  const store = new ChatStore(":memory:");
  chatStores.push(store);
  return store;
}

function createRuntime() {
  return new GameRuntime({
    localAddress: "192.168.1.20",
    webPort: 5173,
    roomCode: "123456",
    joinToken: "abcdefghijklmnopqrstuvwxyz123456"
  });
}

describe("game runtime host control framework", () => {
  it("restores an active private game offline and paused with reconnect credentials intact", () => {
    const runtime = createRuntime();
    const sessions = ["林野", "阿岚", "青禾", "南星"].map((nickname, index) => runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname
    }, `socket-${index}`));
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    runtime.room.updateRoleConfiguration({ wolf: 1, villager: 2, seer: 1, witch: 0 });
    runtime.room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      runtime.room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return runtime.room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    runtime.room.sendWolfMessage(wolf.selfId, { kind: "text", text: "恢复后仍应存在" });
    runtime.room.selectWolfTarget(wolf.selfId, "no-kill");
    runtime.phaseClock.start(90_000, 10_000);

    const snapshot = runtime.createSnapshot(40_000);
    const restored = new GameRuntime({ localAddress: "192.168.1.99", webPort: 5273, snapshot });

    expect(restored.room.getHostView()).toMatchObject({
      roomCode: "123456",
      phase: "first-night",
      players: expect.arrayContaining([expect.objectContaining({ connection: "offline" })])
    });
    expect(restored.room.getJoinUrl()).toContain("192.168.1.99:5273");
    expect(restored.getPublicGameState().clock).toMatchObject({ status: "paused", remainingMs: 60_000 });
    expect(restored.room.getPlayerView(wolf.selfId)?.wolfAction).toMatchObject({
      target: "no-kill",
      messages: [expect.objectContaining({
        content: { kind: "text", text: "恢复后仍应存在" }
      })]
    });
    const original = sessions.find((session) => session.ok && session.data.lobby.selfId === wolf.selfId);
    if (!original?.ok) throw new Error("test setup failed");
    expect(restored.room.reconnect(original.data.credentials, "restored-socket")).toMatchObject({
      ok: true,
      data: { session: { lobby: { selfId: wolf.selfId } } }
    });
  });

  it("imports legacy v1 wolf chat into SQLite during recovery", () => {
    const runtime = createRuntime();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) => runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname
    }, `socket-v1-${index}`));
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    runtime.room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    runtime.room.startGame(new Date("2026-07-19T08:00:00.000Z"));
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      runtime.room.confirmRole(session.data.lobby.selfId);
      return runtime.room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const sent = runtime.room.sendChat(
      wolf.selfId,
      { channel: "wolf-private", content: { kind: "text", text: "旧版狼聊" } },
      new Date("2026-07-19T08:00:01.000Z")
    );
    if (!sent.ok || sent.data.content.kind !== "text") throw new Error("test setup failed");
    const current = runtime.createSnapshot(2_000);
    const {
      chatMessages: _chatMessages,
      chatSequence: _chatSequence,
      gameSessionId: _gameSessionId,
      ...legacyRoom
    } = current.room;
    const legacySnapshot: GameRuntimeSnapshot = {
      ...current,
      version: 1,
      room: {
        ...legacyRoom,
        version: 1,
        wolfMessages: [{
          id: sent.data.id,
          sender: {
            id: wolf.selfId,
            number: sent.data.sender.kind === "system" ? 0 : sent.data.sender.number,
            nickname: sent.data.sender.kind === "system" ? "法官" : sent.data.sender.nickname
          },
          kind: "text",
          text: sent.data.content.text,
          target: null,
          createdAt: sent.data.createdAt
        }]
      }
    };
    const store = createChatStore();

    const restored = new GameRuntime({
      localAddress: "192.168.1.99",
      webPort: 5273,
      snapshot: legacySnapshot,
      chatPersistence: store
    });

    expect(restored.room.getChatHistory(
      { kind: "player", playerId: wolf.selfId },
      0,
      100
    )).toMatchObject({
      ok: true,
      data: {
        messages: [{
          sequence: 1,
          channel: "wolf-private",
          content: { kind: "text", text: "旧版狼聊" }
        }],
        latestSequence: 1,
        hasMore: false
      }
    });
  });

  it("restores v2 chat from SQLite when the snapshot omits message bodies", () => {
    const store = createChatStore();
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      chatPersistence: store
    });
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) => runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname
    }, `socket-v2-${index}`));
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    runtime.room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    runtime.room.startGame(new Date("2026-07-19T09:00:00.000Z"));
    const wolf = sessions
      .map((session) => {
        if (!session.ok) throw new Error("test setup failed");
        runtime.room.confirmRole(session.data.lobby.selfId);
        return runtime.room.getPlayerView(session.data.lobby.selfId)!;
      })
      .find((view) => view.privateRole?.role === "wolf")!;
    expect(runtime.room.sendChat(
      wolf.selfId,
      { channel: "wolf-private", content: { kind: "text", text: "数据库中的消息" } },
      new Date("2026-07-19T09:00:01.000Z")
    )).toMatchObject({ ok: true, data: { sequence: 1 } });

    const snapshot = runtime.createSnapshot(2_000);
    expect(snapshot).toMatchObject({
      version: 2,
      room: {
        version: 2,
        chatSequence: 1,
        gameSessionId: expect.any(String)
      }
    });
    expect(snapshot.room).not.toHaveProperty("chatMessages");

    const restored = new GameRuntime({
      localAddress: "192.168.1.99",
      webPort: 5273,
      snapshot,
      chatPersistence: store
    });

    expect(restored.room.getPlayerView(wolf.selfId)?.wolfAction?.messages).toEqual([
      expect.objectContaining({
        sequence: 1,
        content: { kind: "text", text: "数据库中的消息" }
      })
    ]);
    expect(restored.room.createSnapshot()).not.toHaveProperty("chatMessages");
  });

  it("records public host interventions without private game data", () => {
    const runtime = createRuntime();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) => runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname
    }, `socket-${index}`));
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    runtime.room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    runtime.room.startGame();
    runtime.phaseClock.start(60_000, 0);
    runtime.pausePhase(20_000);
    runtime.adjustPhaseTime(15_000, 21_000);
    runtime.resumePhase(30_000);
    runtime.forceEndPhase(35_000);

    expect(runtime.getPublicInterventions()).toEqual([
      expect.objectContaining({ type: "pause", detail: "主机暂停了当前阶段" }),
      expect.objectContaining({ type: "adjust-time", detail: "主机将当前阶段延长 15 秒" }),
      expect.objectContaining({ type: "resume", detail: "主机继续了当前阶段" }),
      expect.objectContaining({ type: "force-end", detail: "主机强制终止了对局" })
    ]);
    expect(JSON.stringify(runtime.getPublicInterventions())).not.toMatch(/role|identity|action/i);
  });

  it("keeps the exact remaining time after host pause and resume", () => {
    const runtime = createRuntime();
    runtime.phaseClock.start(90_000, 10_000);
    const paused = runtime.pausePhase(40_000);
    const resumed = runtime.resumePhase(100_000);

    expect(paused.ok && paused.data.clock.remainingMs).toBe(60_000);
    expect(resumed.ok && resumed.data.clock.deadlineAt).toBe(new Date(160_000).toISOString());
  });

  it("rejects invalid controls without recording or revising public state", () => {
    const runtime = createRuntime();

    expect(runtime.pausePhase(1_000)).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(runtime.resumePhase(1_000)).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(runtime.adjustPhaseTime(15_000, 1_000)).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(runtime.forceEndPhase(1_000)).toMatchObject({ ok: false, code: "INVALID_PHASE_CONTROL" });
    expect(runtime.getPublicGameState(1_000)).toMatchObject({ revision: 0, interventions: [] });
  });

  it("returns a validated public state with one revision per successful control", () => {
    const runtime = createRuntime();
    runtime.phaseClock.start(60_000, 0);

    const paused = runtime.pausePhase(10_000);
    if (!paused.ok) throw new Error("test setup failed");
    const adjusted = runtime.adjustPhaseTime(15_000, 10_000);
    if (!adjusted.ok) throw new Error("test setup failed");

    expect(paused.data).toMatchObject({ revision: 1, clock: { status: "paused", remainingMs: 50_000 } });
    expect(adjusted.data).toMatchObject({ revision: 2, clock: { status: "paused", remainingMs: 65_000 } });
    expect(adjusted.data.interventions).toHaveLength(2);
  });

  it("records player departure as a public host intervention", () => {
    const runtime = createRuntime();
    const joined = runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname: "阿岚"
    }, "socket-a");
    if (!joined.ok) throw new Error("test setup failed");

    const departed = runtime.departPlayer(joined.data.lobby.selfId, 10_000);

    expect(departed).toMatchObject({
      ok: true,
      data: {
        view: { players: [expect.objectContaining({ connection: "departed" })] },
        game: {
          revision: 1,
          interventions: [expect.objectContaining({
            type: "depart-player",
            detail: "主机将 1 号玩家阿岚判定为离场"
          })]
        }
      }
    });
    if (!departed.ok) throw new Error("test setup failed");
    expect(JSON.stringify(departed.data.game)).not.toMatch(/reconnectToken|socketId|identity|role/);
  });

  it("skips a running night stage with a public intervention", () => {
    const runtime = createRuntime();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) => runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname
    }, `socket-${index}`));
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    runtime.room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    runtime.room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      runtime.room.confirmRole(session.data.lobby.selfId);
    }
    runtime.phaseClock.start(90_000, 0);

    const skipped = runtime.skipNightPhase(10_000);

    expect(skipped).toMatchObject({
      ok: true,
      data: {
        clock: { status: "ended" },
        interventions: [expect.objectContaining({
          type: "skip-phase",
          detail: "主机跳过了当前夜间阶段"
        })]
      }
    });
    expect(runtime.room.getNightStage()).toBe("seer");
    expect(JSON.stringify(skipped)).not.toMatch(/wolf|seer|witch|target|identity|"role"/);
  });

  it("skips a running day stage without exposing private ballots", () => {
    const runtime = createRuntime();
    const sessions = ["林野", "阿岚", "青禾"].map((nickname, index) => runtime.room.join({
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      nickname
    }, `socket-${index}`));
    if (sessions.some((session) => !session.ok)) throw new Error("test setup failed");
    runtime.room.updateRoleConfiguration({ wolf: 1, villager: 1, seer: 1, witch: 0 });
    runtime.room.startGame();
    for (const session of sessions) {
      if (!session.ok) throw new Error("test setup failed");
      runtime.room.confirmRole(session.data.lobby.selfId);
    }
    const views = sessions.map((session) => {
      if (!session.ok) throw new Error("test setup failed");
      return runtime.room.getPlayerView(session.data.lobby.selfId)!;
    });
    const wolf = views.find((view) => view.privateRole?.role === "wolf")!;
    const seer = views.find((view) => view.privateRole?.role === "seer")!;
    runtime.room.selectWolfTarget(wolf.selfId, "no-kill");
    runtime.room.confirmWolfVote(wolf.selfId, true);
    runtime.room.inspectAsSeer(seer.selfId, wolf.selfId);
    runtime.room.continueFromDawn();
    runtime.phaseClock.start(60_000, 0);

    const skipped = runtime.skipDayPhase(10_000);

    expect(skipped).toMatchObject({ ok: true, data: { clock: { status: "ended" } } });
    expect(runtime.getPublicInterventions()).toContainEqual(expect.objectContaining({
      type: "skip-phase",
      detail: "主机跳过了当前白天阶段"
    }));
    expect(JSON.stringify(skipped)).not.toMatch(/dayVoteTarget|ballot|target/);
  });
});
