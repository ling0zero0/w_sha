import { z } from "zod";
import { playerIdSchema, wolfVoteTargetSchema } from "./domain.js";
import { dayVoteTargetSchema } from "./game.js";

export const hostPlayerRequestSchema = z.object({ playerId: playerIdSchema });
export type HostPlayerRequest = z.infer<typeof hostPlayerRequestSchema>;

export const hostCorrectPlayerLifeRequestSchema = hostPlayerRequestSchema.extend({ alive: z.boolean() });
export type HostCorrectPlayerLifeRequest = z.infer<typeof hostCorrectPlayerLifeRequestSchema>;

export const hostMovePlayerRequestSchema = hostPlayerRequestSchema.extend({ direction: z.enum(["up", "down"]) });
export type HostMovePlayerRequest = z.infer<typeof hostMovePlayerRequestSchema>;

export const hostResolveTakeoverRequestSchema = z.object({ requestId: z.uuid(), approved: z.boolean() });
export type HostResolveTakeoverRequest = z.infer<typeof hostResolveTakeoverRequestSchema>;

export const hostAdjustPhaseTimeRequestSchema = z.object({
  deltaMs: z.number().int().min(-300_000).max(300_000).refine((value) => value !== 0)
});
export type HostAdjustPhaseTimeRequest = z.infer<typeof hostAdjustPhaseTimeRequestSchema>;

export const wolfSelectTargetRequestSchema = z.object({ target: wolfVoteTargetSchema });
export type WolfSelectTargetRequest = z.infer<typeof wolfSelectTargetRequestSchema>;

export const wolfConfirmVoteRequestSchema = z.object({ confirmed: z.boolean() });
export type WolfConfirmVoteRequest = z.infer<typeof wolfConfirmVoteRequestSchema>;

export const wolfSendMessageRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(80) }),
  z.object({ kind: z.literal("quick"), code: z.enum(["agree", "disagree", "no-kill"]) }),
  z.object({ kind: z.literal("target-suggestion"), target: playerIdSchema })
]);
export type WolfSendMessageRequest = z.infer<typeof wolfSendMessageRequestSchema>;

export const seerInspectRequestSchema = z.object({ target: playerIdSchema });
export type SeerInspectRequest = z.infer<typeof seerInspectRequestSchema>;

export const witchSubmitActionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("save") }),
  z.object({ action: z.literal("poison"), target: playerIdSchema })
]);
export type WitchSubmitActionRequest = z.infer<typeof witchSubmitActionRequestSchema>;

export const guardProtectRequestSchema = z.object({ target: playerIdSchema.nullable() }).strict();
export type GuardProtectRequest = z.infer<typeof guardProtectRequestSchema>;

export const hunterShootRequestSchema = z.object({ target: playerIdSchema.nullable() }).strict();
export type HunterShootRequest = z.infer<typeof hunterShootRequestSchema>;

export const daySelectVoteRequestSchema = z.object({ target: dayVoteTargetSchema });
export type DaySelectVoteRequest = z.infer<typeof daySelectVoteRequestSchema>;

export const dayConfirmVoteRequestSchema = z.object({ confirmed: z.boolean() });
export type DayConfirmVoteRequest = z.infer<typeof dayConfirmVoteRequestSchema>;

export const roomErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "INVALID_HOST_SESSION",
  "INVALID_JOIN_CREDENTIALS",
  "NICKNAME_TAKEN",
  "ALREADY_JOINED",
  "PLAYER_NOT_FOUND",
  "INVALID_RECONNECT_CREDENTIALS",
  "TAKEOVER_ALREADY_PENDING",
  "TAKEOVER_REQUEST_NOT_FOUND",
  "PLAYER_ALREADY_DEPARTED",
  "INVALID_PHASE_CONTROL",
  "GAME_ALREADY_STARTED",
  "GAME_NOT_READY",
  "ROLE_ALREADY_CONFIRMED",
  "INVALID_NIGHT_ACTION",
  "NIGHT_ACTION_LOCKED",
  "CHAT_RATE_LIMITED"
]);
export type RoomErrorCode = z.infer<typeof roomErrorCodeSchema>;

export const roomActionFailureSchema = z.object({
  ok: z.literal(false),
  code: roomErrorCodeSchema,
  message: z.string().min(1)
});
export type RoomActionFailure = z.infer<typeof roomActionFailureSchema>;

export type RoomActionResult<T> = { ok: true; data: T } | RoomActionFailure;
export type RoomActionAck<T> = (result: RoomActionResult<T>) => void;
export type EmptyActionResult = { revision: number };
