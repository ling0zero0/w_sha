import {
  botKindSchema,
  chatMessageSchema,
  chatModeSchema,
  dayVoteTargetSchema,
  gameRecordSchema,
  joinTokenSchema,
  nicknameSchema,
  playerConnectionSchema,
  playerIdSchema,
  roleConfigurationSchema,
  roleSchema,
  roomCodeSchema,
  roomPhaseSchema,
  wolfChatMessageSchema,
  wolfVoteTargetSchema,
  publicHostInterventionSchema,
  aiBotProfileIdSchema,
  aiModelProfileIdSchema,
  playerControllerSchema
} from "@werewolf/shared";
import { z } from "zod";
import type { GameRuntimeSnapshot } from "./runtime.js";

const snapshotVersionSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const reconnectTokenHashSchema = z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/);

const snapshotPlayerSchema = z.object({
  id: playerIdSchema,
  number: z.number().int().positive(),
  nickname: nicknameSchema,
  connection: playerConnectionSchema,
  alive: z.boolean().default(true),
  controller: playerControllerSchema.optional(),
  botKind: botKindSchema.nullable().optional(),
  botProfileId: aiBotProfileIdSchema.nullable().optional(),
  aiConfigurationLocked: z.boolean().optional(),
  aiBotProfileRevision: z.number().int().positive().nullable().optional(),
  aiModelProfileId: aiModelProfileIdSchema.nullable().optional(),
  aiModelProfileRevision: z.number().int().positive().nullable().optional(),
  aiModelChainRevision: z.string().min(1).nullable().optional(),
  role: roleSchema.nullable(),
  roleConfirmed: z.boolean(),
  wolfVoteTarget: wolfVoteTargetSchema,
  wolfVoteConfirmed: z.boolean(),
  seerInspectedPlayerId: playerIdSchema.nullable(),
  witchAntidoteAvailable: z.boolean(),
  witchPoisonAvailable: z.boolean(),
  lastChatMessageAtMs: z.number().int().nonnegative().nullable().optional(),
  lastWolfMessageAtMs: z.number().int().nonnegative().nullable().optional(),
  dayVoteTarget: dayVoteTargetSchema,
  dayVoteConfirmed: z.boolean(),
  idiotRevealed: z.boolean().optional(),
  reconnectTokenHash: reconnectTokenHashSchema
}).strict();

const pendingWitchActionSchema = z.object({
  saved: z.boolean(),
  poisonTargetId: playerIdSchema.nullable()
}).strict();

const pendingHunterResolutionSchema = z.object({
  hunterId: playerIdSchema,
  origin: z.enum(["night", "exile"])
}).strict();

const dayVoteResultSchema = z.object({
  voterId: playerIdSchema,
  targetId: playerIdSchema.nullable()
}).strict();

export const lobbyRoomSnapshotSchema = z.object({
  version: snapshotVersionSchema,
  roomCode: roomCodeSchema,
  joinToken: joinTokenSchema,
  revision: z.number().int().nonnegative(),
  phase: roomPhaseSchema,
  nightStage: z.enum(["wolf", "seer", "guard", "witch", "complete"]),
  wolfVoteLocked: z.boolean(),
  wolfAttackTargetId: playerIdSchema.nullable(),
  witchActionSubmitted: z.boolean(),
  dawnDeathIds: z.array(playerIdSchema),
  chatMessages: z.array(chatMessageSchema).optional(),
  chatSequence: z.number().int().nonnegative().optional(),
  gameSessionId: z.uuid().nullable().optional(),
  gameSessionStartedAt: z.iso.datetime().nullable().optional(),
  wolfMessages: z.array(wolfChatMessageSchema).optional(),
  speechOrderIds: z.array(playerIdSchema),
  currentSpeakerIndex: z.number().int().min(-1),
  dayVoteResult: z.array(dayVoteResultSchema).nullable(),
  exiledPlayerId: playerIdSchema.nullable(),
  currentSpeakerFinished: z.boolean().optional(),
  pendingWitchAction: pendingWitchActionSchema.nullable().optional(),
  guardTargetId: playerIdSchema.nullable().optional(),
  lastGuardTargetId: playerIdSchema.nullable().optional(),
  guardActionSubmitted: z.boolean().optional(),
  pendingHunterResolution: pendingHunterResolutionSchema.nullable().optional(),
  hunterShotPlayerId: playerIdSchema.nullable().optional(),
  hunterActionSubmitted: z.boolean().optional(),
  revealedIdiotId: playerIdSchema.nullable().optional(),
  chatMode: chatModeSchema.optional(),
  dayNumber: z.number().int().positive(),
  gameOutcome: z.enum(["good-win", "wolf-win", "draw", "terminated"]).nullable(),
  gameRecords: z.array(gameRecordSchema),
  roleConfiguration: roleConfigurationSchema,
  players: z.array(snapshotPlayerSchema)
}).strict();

export const gameRuntimeSnapshotSchema = z.object({
  version: snapshotVersionSchema,
  room: lobbyRoomSnapshotSchema,
  publicRevision: z.number().int().nonnegative(),
  interventions: z.array(publicHostInterventionSchema),
  clockRemainingMs: z.number().int().nonnegative()
}).strict();

export function parseGameRuntimeSnapshot(value: unknown): GameRuntimeSnapshot {
  return gameRuntimeSnapshotSchema.parse(value) as GameRuntimeSnapshot;
}
