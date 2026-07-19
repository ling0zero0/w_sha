import { z } from "zod";
import {
  lobbyPlayerSchema,
  playerIdSchema,
  roleConfirmationProgressSchema,
  roleSchema,
  wolfVoteTargetSchema
} from "./domain.js";

export const nightCandidateSchema = lobbyPlayerSchema.pick({
  id: true,
  number: true,
  nickname: true
});

export const privateRoleSchema = z.object({
  role: roleSchema,
  confirmed: z.boolean(),
  wolfTeammates: z.array(nightCandidateSchema)
});
export type PrivateRole = z.infer<typeof privateRoleSchema>;

export const wolfChatMessageSchema = z.object({
  id: z.uuid(),
  sender: nightCandidateSchema,
  kind: z.enum(["text", "quick", "target-suggestion"]),
  text: z.string().min(1).max(80),
  target: nightCandidateSchema.nullable(),
  createdAt: z.iso.datetime()
});
export type WolfChatMessage = z.infer<typeof wolfChatMessageSchema>;

export const privateWolfActionSchema = z.object({
  candidates: z.array(nightCandidateSchema),
  target: wolfVoteTargetSchema,
  confirmed: z.boolean(),
  locked: z.boolean(),
  chatEnabled: z.boolean(),
  messages: z.array(wolfChatMessageSchema)
});
export type PrivateWolfAction = z.infer<typeof privateWolfActionSchema>;

export const privateSeerActionSchema = z.object({
  active: z.boolean(),
  candidates: z.array(nightCandidateSchema),
  inspectedPlayer: nightCandidateSchema.nullable(),
  result: z.enum(["wolf", "good"]).nullable()
});
export type PrivateSeerAction = z.infer<typeof privateSeerActionSchema>;

export const witchActionChoiceSchema = z.enum(["none", "save", "poison"]);
export type WitchActionChoice = z.infer<typeof witchActionChoiceSchema>;

export const privateWitchActionSchema = z.object({
  active: z.boolean(),
  attackedPlayer: nightCandidateSchema.nullable(),
  antidoteAvailable: z.boolean(),
  poisonAvailable: z.boolean(),
  poisonCandidates: z.array(nightCandidateSchema),
  submitted: z.boolean()
});
export type PrivateWitchAction = z.infer<typeof privateWitchActionSchema>;

export const privateGuardActionSchema = z.object({
  active: z.boolean(),
  candidates: z.array(nightCandidateSchema),
  protectedPlayer: nightCandidateSchema.nullable(),
  submitted: z.boolean()
}).strict();
export type PrivateGuardAction = z.infer<typeof privateGuardActionSchema>;

export const privateHunterActionSchema = z.object({
  active: z.boolean(),
  candidates: z.array(nightCandidateSchema),
  shotPlayer: nightCandidateSchema.nullable(),
  submitted: z.boolean()
}).strict();
export type PrivateHunterAction = z.infer<typeof privateHunterActionSchema>;

export const dawnResultSchema = z.object({
  deaths: z.array(nightCandidateSchema)
}).nullable();
export type DawnResult = z.infer<typeof dawnResultSchema>;

export const gameRecordSchema = z.object({
  type: z.enum([
    "death",
    "seer-inspection",
    "witch-action",
    "guard-action",
    "hunter-shot",
    "idiot-reveal",
    "day-vote",
    "host-intervention"
  ]),
  day: z.number().int().positive(),
  detail: z.string().min(1)
});
export type GameRecord = z.infer<typeof gameRecordSchema>;

export const gameResultSchema = z.object({
  outcome: z.enum(["good-win", "wolf-win", "draw", "terminated"]),
  revealedPlayers: z.array(nightCandidateSchema.extend({
    role: roleSchema,
    alive: z.boolean()
  })),
  records: z.array(gameRecordSchema)
}).nullable();
export type GameResult = z.infer<typeof gameResultSchema>;

export const publicDayStateSchema = z.object({
  alivePlayerIds: z.array(playerIdSchema),
  revealedIdiot: nightCandidateSchema.nullable(),
  hunterPending: z.boolean(),
  currentSpeaker: nightCandidateSchema.nullable(),
  speechOrder: z.array(nightCandidateSchema),
  voteProgress: roleConfirmationProgressSchema.nullable(),
  voteResult: z.object({
    ballots: z.array(z.object({
      voter: nightCandidateSchema,
      target: nightCandidateSchema.nullable()
    })),
    exiledPlayer: nightCandidateSchema.nullable()
  }).nullable()
}).nullable();
export type PublicDayState = z.infer<typeof publicDayStateSchema>;

export const dayVoteTargetSchema = z.union([playerIdSchema, z.literal("abstain")]).nullable();
export type DayVoteTarget = z.infer<typeof dayVoteTargetSchema>;

export const privateDayVoteSchema = z.object({
  eligible: z.boolean(),
  candidates: z.array(nightCandidateSchema),
  target: dayVoteTargetSchema,
  confirmed: z.boolean()
}).nullable();
export type PrivateDayVote = z.infer<typeof privateDayVoteSchema>;

export const clockStatusSchema = z.enum(["idle", "running", "paused", "ended"]);
export type ClockStatus = z.infer<typeof clockStatusSchema>;

export const publicPhaseClockSchema = z.object({
  status: clockStatusSchema,
  deadlineAt: z.iso.datetime().nullable(),
  remainingMs: z.number().int().nonnegative()
});
export type PublicPhaseClock = z.infer<typeof publicPhaseClockSchema>;

export const hostInterventionTypeSchema = z.enum([
  "pause",
  "resume",
  "adjust-time",
  "force-end",
  "skip-phase",
  "depart-player",
  "correct-life"
]);
export type HostInterventionType = z.infer<typeof hostInterventionTypeSchema>;

export const publicHostInterventionSchema = z.object({
  id: z.uuid(),
  type: hostInterventionTypeSchema,
  createdAt: z.iso.datetime(),
  detail: z.string().min(1)
});
export type PublicHostIntervention = z.infer<typeof publicHostInterventionSchema>;

export const publicGameStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  clock: publicPhaseClockSchema,
  interventions: z.array(publicHostInterventionSchema)
});
export type PublicGameState = z.infer<typeof publicGameStateSchema>;
