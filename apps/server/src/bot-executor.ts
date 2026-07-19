import {
  botIntentSchema,
  chatSendRequestSchema,
  dayConfirmVoteRequestSchema,
  daySelectVoteRequestSchema,
  guardProtectRequestSchema,
  hunterShootRequestSchema,
  seerInspectRequestSchema,
  witchSubmitActionRequestSchema,
  wolfConfirmVoteRequestSchema,
  wolfSelectTargetRequestSchema,
  type BotIntent,
  type ChatMessage,
  type PlayerId
} from "@werewolf/shared";
import type { LobbyRoom } from "./room.js";

export interface BotExecutionResult {
  accepted: boolean;
  chatMessage: ChatMessage | null;
}

export function executeBotIntent(
  room: LobbyRoom,
  playerId: PlayerId,
  rawIntent: BotIntent,
  expectedRevision: number,
  paused = false
): BotExecutionResult {
  const view = room.getPlayerView(playerId);
  if (
    !view
    || view.revision !== expectedRevision
    || !room.getBotSeats().some((seat) => seat.playerId === playerId)
  ) return { accepted: false, chatMessage: null };

  const intent = botIntentSchema.parse(rawIntent);
  if (paused && intent.type !== "confirm-role") {
    return { accepted: false, chatMessage: null };
  }

  switch (intent.type) {
    case "confirm-role":
      return result(room.confirmRole(playerId));
    case "wolf-select-target": {
      const payload = wolfSelectTargetRequestSchema.parse(intent.payload);
      return result(room.selectWolfTarget(playerId, payload.target));
    }
    case "wolf-confirm-vote": {
      const payload = wolfConfirmVoteRequestSchema.parse(intent.payload);
      return result(room.confirmWolfVote(playerId, payload.confirmed));
    }
    case "chat-send": {
      const payload = chatSendRequestSchema.parse(intent.payload);
      const action = room.sendChat(playerId, payload);
      return action.ok
        ? { accepted: true, chatMessage: action.data }
        : { accepted: false, chatMessage: null };
    }
    case "seer-inspect": {
      const payload = seerInspectRequestSchema.parse(intent.payload);
      return result(room.inspectAsSeer(playerId, payload.target));
    }
    case "witch-submit-action": {
      const payload = witchSubmitActionRequestSchema.parse(intent.payload);
      return result(room.submitWitchAction(playerId, payload));
    }
    case "guard-protect": {
      const payload = guardProtectRequestSchema.parse(intent.payload);
      return result(room.protectAsGuard(playerId, payload.target));
    }
    case "hunter-shoot": {
      const payload = hunterShootRequestSchema.parse(intent.payload);
      return result(room.shootAsHunter(playerId, payload.target));
    }
    case "finish-speaking":
      return result(room.finishSpeaking(playerId));
    case "day-select-vote": {
      const payload = daySelectVoteRequestSchema.parse(intent.payload);
      return result(room.selectDayVote(playerId, payload.target));
    }
    case "day-confirm-vote": {
      const payload = dayConfirmVoteRequestSchema.parse(intent.payload);
      return result(room.confirmDayVote(playerId, payload.confirmed));
    }
  }
}

function result(action: { ok: boolean }): BotExecutionResult {
  return { accepted: action.ok, chatMessage: null };
}
