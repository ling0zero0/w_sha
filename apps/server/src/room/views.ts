import { findPlayer } from "./state.js";
import { getChannelMessages, getPublicChatMessages } from "./chat.js";
import { canSendPublicChat, getPublicDayState } from "./day-procedure.js";
import { getRoleConfirmationProgress, publicPlayers, toNightCandidate, type GameState, type RoomViewContext } from "./state.js";
import { evaluateStartReadiness } from "../role-configuration.js";
import { hostLobbyViewSchema, playerLobbyViewSchema, playerSessionSchema } from "@werewolf/shared";
import type { HostLobbyView, PlayerId, PlayerLobbyView, PlayerSession } from "@werewolf/shared";

export function createSession(state: GameState, playerId: PlayerId, reconnectToken: string, context: RoomViewContext): PlayerSession {
  return playerSessionSchema.parse({
    credentials: { roomCode: context.roomCode, playerId, reconnectToken },
    lobby: getPlayerView(state, playerId, context)
  });
}

export function getHostView(state: GameState, context: RoomViewContext): HostLobbyView {
  return hostLobbyViewSchema.parse({
    phase: state.phase,
    roomCode: context.roomCode,
    revision: state.revision,
    players: publicPlayers(state),
    chatMode: state.chatMode,
    revealedIdiotId: state.revealedIdiotId,
    joinUrl: context.joinUrl,
    localAddress: context.localAddress,
    takeoverRequests: state.takeoverRequests.map(({ socketId: _socketId, ...request }) => request),
    roleConfiguration: state.roleConfiguration,
    startReadiness: evaluateStartReadiness(state.roleConfiguration, state.players.filter((player) => player.connection !== "departed").length),
    roleConfirmation: getRoleConfirmationProgress(state),
    nightProgress: getNightProgress(state),
    dawnResult:
      state.phase === "dawn"
        ? {
            deaths: state.dawnDeathIds.flatMap((id) => {
              const candidate = toNightCandidate(state, id);
              return candidate ? [candidate] : [];
            })
          }
        : null,
    dayState: getPublicDayState(state),
    gameResult: getGameResult(state),
    publicChat: {
      canSend: false,
      messages: getPublicChatMessages(state)
    }
  });
}

export function getPlayerView(state: GameState, playerId: PlayerId, context: RoomViewContext): PlayerLobbyView | null {
  const player = findPlayer(state, playerId);
  if (!player) return null;
  return playerLobbyViewSchema.parse({
    phase: state.phase,
    roomCode: context.roomCode,
    revision: state.revision,
    players: publicPlayers(state),
    chatMode: state.chatMode,
    revealedIdiotId: state.revealedIdiotId,
    selfId: playerId,
    privateRole: player.role
      ? {
          role: player.role,
          confirmed: player.roleConfirmed,
          wolfTeammates:
            player.role === "wolf"
              ? state.players
                  .filter((candidate) => candidate.id !== player.id && candidate.role === "wolf" && candidate.alive)
                  .map(({ id, number, nickname }) => ({ id, number, nickname }))
              : []
        }
      : null,
    roleConfirmation: getRoleConfirmationProgress(state),
    nightProgress: getNightProgress(state),
    wolfAction:
      state.phase === "first-night" && player.role === "wolf" && player.alive
        ? {
            candidates: state.players
              .filter((candidate) => candidate.alive && candidate.connection !== "departed")
              .map(({ id, number, nickname }) => ({ id, number, nickname })),
            target: player.wolfVoteTarget,
            confirmed: player.wolfVoteConfirmed,
            locked: state.wolfVoteLocked,
            chatEnabled: state.nightStage === "wolf" && !state.wolfVoteLocked,
            messages: getChannelMessages(state, "wolf-private")
          }
        : null,
    seerAction:
      state.phase === "first-night" && player.role === "seer" && player.alive
        ? {
            active: state.nightStage === "seer",
            candidates: state.players
              .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id)
              .map(({ id, number, nickname }) => ({ id, number, nickname })),
            inspectedPlayer: player.seerInspectedPlayerId ? toNightCandidate(state, player.seerInspectedPlayerId) : null,
            result: player.seerInspectedPlayerId
              ? findPlayer(state, player.seerInspectedPlayerId)?.role === "wolf"
                ? "wolf"
                : "good"
              : null
          }
        : null,
    witchAction:
      state.phase === "first-night" && player.role === "witch" && player.alive
        ? {
            active: state.nightStage === "witch",
            attackedPlayer: state.wolfAttackTargetId ? toNightCandidate(state, state.wolfAttackTargetId) : null,
            antidoteAvailable: player.witchAntidoteAvailable,
            poisonAvailable: player.witchPoisonAvailable,
            poisonCandidates: state.players
              .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id)
              .map(({ id, number, nickname }) => ({ id, number, nickname })),
            submitted: state.witchActionSubmitted
          }
        : null,
    guardAction:
      state.phase === "first-night" && player.role === "guard" && player.alive
        ? {
            active: state.nightStage === "guard",
            candidates: state.players
              .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== state.lastGuardTargetId)
              .map(({ id, number, nickname }) => ({ id, number, nickname })),
            protectedPlayer: state.guardTargetId ? toNightCandidate(state, state.guardTargetId) : null,
            submitted: state.guardActionSubmitted
          }
        : null,
    hunterAction:
      player.role === "hunter"
        ? {
            active: state.pendingHunterResolution?.hunterId === player.id && !state.hunterActionSubmitted,
            candidates:
              state.pendingHunterResolution?.hunterId === player.id && !state.hunterActionSubmitted
                ? state.players
                    .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id)
                    .map(({ id, number, nickname }) => ({ id, number, nickname }))
                : [],
            shotPlayer: state.hunterShotPlayerId ? toNightCandidate(state, state.hunterShotPlayerId) : null,
            submitted: state.hunterActionSubmitted
          }
        : null,
    dawnResult:
      state.phase === "dawn"
        ? {
            deaths: state.dawnDeathIds.flatMap((id) => {
              const candidate = toNightCandidate(state, id);
              return candidate ? [candidate] : [];
            })
          }
        : null,
    dayState: getPublicDayState(state),
    dayVote:
      state.phase === "day-vote" && player.alive
        ? {
            eligible: !player.idiotRevealed,
            candidates: player.idiotRevealed
              ? []
              : state.players
                  .filter((candidate) => candidate.alive && candidate.connection !== "departed" && candidate.id !== player.id && !candidate.idiotRevealed)
                  .map(({ id, number, nickname }) => ({ id, number, nickname })),
            target: player.dayVoteTarget,
            confirmed: player.dayVoteConfirmed
          }
        : null,
    gameResult: getGameResult(state),
    publicChat: {
      canSend: canSendPublicChat(state, player),
      messages: getPublicChatMessages(state)
    }
  });
}

export function getNightProgress(state: GameState): { stage: "night-action"; confirmed: number; required: number; locked: boolean } | null {
  if (state.phase !== "first-night") return null;
  return {
    stage: "night-action",
    confirmed: 0,
    required: 0,
    locked: false
  };
}

export function getGameResult(state: GameState) {
  if (state.phase !== "game-over" || !state.gameOutcome) return null;
  return {
    outcome: state.gameOutcome,
    revealedPlayers: state.players.flatMap((player) =>
      player.role
        ? [
            {
              id: player.id,
              number: player.number,
              nickname: player.nickname,
              role: player.role,
              alive: player.alive
            }
          ]
        : []
    ),
    records: state.gameRecords.map((record) => ({ ...record }))
  };
}
