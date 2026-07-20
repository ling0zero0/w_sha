import { z } from "zod";
import { aiBotProfileIdSchema } from "./ai.js";

export const roomCodeSchema = z.string().regex(/^\d{6}$/);
export type RoomCode = z.infer<typeof roomCodeSchema>;

export const joinTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
export type JoinToken = z.infer<typeof joinTokenSchema>;

export const playerIdSchema = z.uuid();
export type PlayerId = z.infer<typeof playerIdSchema>;

export const nicknameSchema = z.string().trim().min(1).max(12);
export type Nickname = z.infer<typeof nicknameSchema>;

export const playerConnectionSchema = z.enum(["online", "reconnecting", "offline", "departed"]);
export type PlayerConnection = z.infer<typeof playerConnectionSchema>;

export const playerControllerSchema = z.enum(["human", "bot"]).default("human");
export type PlayerController = z.infer<typeof playerControllerSchema>;

export const botKindSchema = z.enum(["deterministic", "llm"]);
export type BotKind = z.infer<typeof botKindSchema>;

export const botConfigurationSchema = z.union([
  z.object({
    controller: z.literal("human"),
    botKind: z.null(),
    botProfileId: z.null()
  }).strict(),
  z.object({
    controller: z.literal("bot"),
    botKind: z.literal("deterministic"),
    botProfileId: z.null()
  }).strict(),
  z.object({
    controller: z.literal("bot"),
    botKind: z.literal("llm"),
    botProfileId: aiBotProfileIdSchema
  }).strict()
]);
export type BotConfiguration = z.infer<typeof botConfigurationSchema>;

export const chatModeSchema = z.enum(["ordered", "open"]).default("ordered");
export type ChatMode = z.infer<typeof chatModeSchema>;

export const reconnectTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
export type ReconnectToken = z.infer<typeof reconnectTokenSchema>;

const lobbyPlayerBaseSchema = z.object({
  id: playerIdSchema,
  number: z.number().int().positive(),
  nickname: nicknameSchema,
  connection: playerConnectionSchema,
  alive: z.boolean().default(true),
  controller: playerControllerSchema,
  botKind: botKindSchema.nullable().default(null),
  botProfileId: aiBotProfileIdSchema.nullable().default(null)
});

export const lobbyPlayerSchema = lobbyPlayerBaseSchema.superRefine((player, context) => {
  const configuration = {
    controller: player.controller,
    botKind: player.botKind,
    botProfileId: player.botProfileId
  };
  if (!botConfigurationSchema.safeParse(configuration).success) {
    context.addIssue({
      code: "custom",
      path: ["botProfileId"],
      message: "controller, botKind, and botProfileId must describe a valid player controller"
    });
  }
});
lobbyPlayerSchema.pick = lobbyPlayerBaseSchema.pick.bind(lobbyPlayerBaseSchema);
export type LobbyPlayer = z.infer<typeof lobbyPlayerSchema>;

export const roomPhaseSchema = z.enum([
  "lobby",
  "role-reveal",
  "first-night",
  "dawn",
  "last-words",
  "day-speech",
  "day-vote",
  "exile-result",
  "game-over"
]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

export const lobbyViewBaseSchema = z.object({
  phase: roomPhaseSchema,
  roomCode: roomCodeSchema,
  revision: z.number().int().nonnegative(),
  players: z.array(lobbyPlayerSchema),
  chatMode: chatModeSchema,
  revealedIdiotId: playerIdSchema.nullable().default(null)
});

export const takeoverRequestSchema = z.object({
  id: z.uuid(),
  playerId: playerIdSchema,
  nickname: nicknameSchema,
  requestedAt: z.iso.datetime()
});
export type TakeoverRequest = z.infer<typeof takeoverRequestSchema>;

export const roleSchema = z.enum(["wolf", "villager", "seer", "witch", "guard", "hunter", "idiot"]);
export type Role = z.infer<typeof roleSchema>;

export const roleConfigurationSchema = z.object({
  wolf: z.number().int().nonnegative().safe(),
  villager: z.number().int().nonnegative().safe(),
  seer: z.number().int().min(0).max(1),
  witch: z.number().int().min(0).max(1),
  guard: z.number().int().min(0).max(1).default(0),
  hunter: z.number().int().min(0).max(1).default(0),
  idiot: z.number().int().min(0).max(1).default(0)
}).strict();
export type RoleConfigurationInput = z.input<typeof roleConfigurationSchema>;
export type NormalizedRoleConfiguration = z.output<typeof roleConfigurationSchema>;
export type RoleConfiguration = NormalizedRoleConfiguration;

export const startReadinessIssueCodeSchema = z.enum([
  "WOLF_REQUIRED",
  "VILLAGER_REQUIRED",
  "GOD_REQUIRED",
  "ROLE_TOTAL_MISMATCH"
]);
export type StartReadinessIssueCode = z.infer<typeof startReadinessIssueCodeSchema>;

export const startReadinessIssueSchema = z.object({
  code: startReadinessIssueCodeSchema,
  message: z.string().min(1)
});
export type StartReadinessIssue = z.infer<typeof startReadinessIssueSchema>;

export const startReadinessSchema = z.object({
  ready: z.boolean(),
  participantCount: z.number().int().nonnegative(),
  configuredRoleCount: z.number().int().nonnegative(),
  issues: z.array(startReadinessIssueSchema)
});
export type StartReadiness = z.infer<typeof startReadinessSchema>;

export const roleConfirmationProgressSchema = z.object({
  confirmed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
});
export type RoleConfirmationProgress = z.infer<typeof roleConfirmationProgressSchema>;

export const wolfVoteTargetSchema = z.union([playerIdSchema, z.literal("no-kill")]).nullable();
export type WolfVoteTarget = z.infer<typeof wolfVoteTargetSchema>;

export const nightProgressSchema = z.object({
  stage: z.literal("night-action"),
  confirmed: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
  locked: z.boolean()
}).nullable();
export type NightProgress = z.infer<typeof nightProgressSchema>;
