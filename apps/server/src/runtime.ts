import {
  publicGameStateSchema,
  type HostInterventionType,
  type PublicGameState,
  type PublicHostIntervention,
  type PlayerId,
  type RoomActionFailure,
  type RoomActionResult
} from "@werewolf/shared";
import { randomBytes, randomUUID } from "node:crypto";
import { PhaseClock } from "./phase-clock.js";
import { LobbyRoom } from "./room.js";
import type { PlayerDeparture } from "./room.js";
import type { LobbyRoomSnapshot } from "./room.js";

interface RuntimeOptions {
  localAddress: string;
  webPort: number;
  roomCode?: string;
  joinToken?: string;
  hostSession?: string;
  snapshot?: GameRuntimeSnapshot;
}

export interface GameRuntimeSnapshot {
  version: 1;
  room: LobbyRoomSnapshot;
  publicRevision: number;
  interventions: PublicHostIntervention[];
  clockRemainingMs: number;
}

export interface PlayerDepartureOutcome extends PlayerDeparture {
  game: PublicGameState;
}

export interface PlayerLifeCorrectionOutcome {
  view: ReturnType<LobbyRoom["getHostView"]>;
  game: PublicGameState;
}

export class GameRuntime {
  readonly room: LobbyRoom;
  readonly hostSession: string;
  readonly phaseClock = new PhaseClock();
  readonly hostInterventions: PublicHostIntervention[] = [];
  private publicRevision = 0;

  constructor(options: RuntimeOptions) {
    const roomOptions = options.snapshot
      ? { localAddress: options.localAddress, webPort: options.webPort, snapshot: options.snapshot.room }
      : { localAddress: options.localAddress, webPort: options.webPort, ...options.roomCode ? { roomCode: options.roomCode } : {}, ...options.joinToken ? { joinToken: options.joinToken } : {} };
    this.room = new LobbyRoom(roomOptions);
    this.hostSession = options.hostSession ?? randomBytes(32).toString("base64url");
    if (options.snapshot) {
      this.publicRevision = options.snapshot.publicRevision;
      this.hostInterventions.push(...options.snapshot.interventions.map((event) => ({ ...event })));
      if (!["lobby", "game-over"].includes(this.room.getHostView().phase)) {
        this.phaseClock.restorePaused(options.snapshot.clockRemainingMs);
      }
    }
  }

  createSnapshot(nowMs = Date.now()): GameRuntimeSnapshot {
    return {
      version: 1,
      room: this.room.createSnapshot(),
      publicRevision: this.publicRevision,
      interventions: this.getPublicInterventions(),
      clockRemainingMs: this.phaseClock.view(nowMs).remainingMs
    };
  }

  pausePhase(nowMs = Date.now()): RoomActionResult<PublicGameState> {
    if (this.phaseClock.view(nowMs).status !== "running") return this.invalidPhaseControl();
    this.phaseClock.pause(nowMs);
    this.recordIntervention("pause", "主机暂停了当前阶段", nowMs);
    return this.success(nowMs);
  }

  resumePhase(nowMs = Date.now()): RoomActionResult<PublicGameState> {
    if (this.phaseClock.view(nowMs).status !== "paused") return this.invalidPhaseControl();
    this.phaseClock.resume(nowMs);
    this.recordIntervention("resume", "主机继续了当前阶段", nowMs);
    return this.success(nowMs);
  }

  adjustPhaseTime(deltaMs: number, nowMs = Date.now()): RoomActionResult<PublicGameState> {
    const status = this.phaseClock.view(nowMs).status;
    if (status !== "running" && status !== "paused") return this.invalidPhaseControl();
    this.phaseClock.adjust(deltaMs, nowMs);
    const seconds = Math.abs(deltaMs) / 1_000;
    const direction = deltaMs >= 0 ? "延长" : "缩短";
    this.recordIntervention("adjust-time", `主机将当前阶段${direction} ${seconds} 秒`, nowMs);
    return this.success(nowMs);
  }

  forceEndPhase(nowMs = Date.now()): RoomActionResult<PublicGameState> {
    const terminated = this.room.terminateGame();
    if (!terminated.ok) return terminated;
    if (this.phaseClock.view(nowMs).status !== "idle") this.phaseClock.forceEnd(nowMs);
    this.recordIntervention("force-end", "主机强制终止了对局", nowMs);
    return this.success(nowMs);
  }

  skipNightPhase(nowMs = Date.now()): RoomActionResult<PublicGameState> {
    const status = this.phaseClock.view(nowMs).status;
    if ((status !== "running" && status !== "paused") || !this.room.getNightStage()) {
      return this.invalidPhaseControl();
    }
    const skipped = this.room.skipCurrentNightStage();
    if (!skipped.ok) return skipped;
    this.phaseClock.forceEnd(nowMs);
    this.recordIntervention("skip-phase", "主机跳过了当前夜间阶段", nowMs);
    return this.success(nowMs);
  }

  skipDayPhase(nowMs = Date.now()): RoomActionResult<PublicGameState> {
    const status = this.phaseClock.view(nowMs).status;
    const stage = this.room.getTimedStage();
    if ((status !== "running" && status !== "paused") || !stage || ["wolf", "seer", "witch"].includes(stage)) {
      return this.invalidPhaseControl();
    }
    const skipped = this.room.skipCurrentDayStage();
    if (!skipped.ok) return skipped;
    this.phaseClock.forceEnd(nowMs);
    this.recordIntervention("skip-phase", "主机跳过了当前白天阶段", nowMs);
    return this.success(nowMs);
  }

  isPhasePaused(nowMs = Date.now()): boolean {
    return this.phaseClock.view(nowMs).status === "paused";
  }

  departPlayer(playerId: PlayerId, nowMs = Date.now()): RoomActionResult<PlayerDepartureOutcome> {
    const result = this.room.markPlayerDeparted(playerId);
    if (!result.ok) return result;

    const { number, nickname } = result.data.player;
    this.recordIntervention(
      "depart-player",
      `主机将 ${number} 号玩家${nickname}判定为离场`,
      nowMs
    );
    this.publicRevision += 1;
    return {
      ok: true,
      data: {
        ...result.data,
        game: this.getPublicGameState(nowMs)
      }
    };
  }

  correctPlayerLife(
    playerId: PlayerId,
    alive: boolean,
    nowMs = Date.now()
  ): RoomActionResult<PlayerLifeCorrectionOutcome> {
    const result = this.room.correctPlayerLife(playerId, alive);
    if (!result.ok) return result;
    const { number, nickname } = result.data.player;
    this.recordIntervention(
      "correct-life",
      `主机将 ${number} 号玩家${nickname}修正为${alive ? "存活" : "死亡"}`,
      nowMs
    );
    this.publicRevision += 1;
    return {
      ok: true,
      data: {
        view: this.room.getHostView(),
        game: this.getPublicGameState(nowMs)
      }
    };
  }

  getPublicInterventions(): PublicHostIntervention[] {
    return this.hostInterventions.map((event) => ({ ...event }));
  }

  getPublicGameState(nowMs = Date.now()): PublicGameState {
    return publicGameStateSchema.parse({
      revision: this.publicRevision,
      clock: this.phaseClock.view(nowMs),
      interventions: this.getPublicInterventions().slice(-20)
    });
  }

  private success(nowMs: number): RoomActionResult<PublicGameState> {
    this.publicRevision += 1;
    return { ok: true, data: this.getPublicGameState(nowMs) };
  }

  private invalidPhaseControl(): RoomActionFailure {
    return {
      ok: false,
      code: "INVALID_PHASE_CONTROL",
      message: "当前阶段状态不允许此操作"
    };
  }

  private recordIntervention(type: HostInterventionType, detail: string, nowMs: number): void {
    this.hostInterventions.push({
      id: randomUUID(),
      type,
      createdAt: new Date(nowMs).toISOString(),
      detail
    });
    this.room.recordHostIntervention(detail);
  }
}
