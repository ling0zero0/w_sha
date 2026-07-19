import { z } from "zod";
import {
  lobbyPlayerSchema,
  lobbyViewBaseSchema,
  nightProgressSchema,
  nicknameSchema,
  playerIdSchema,
  reconnectTokenSchema,
  roleConfigurationSchema,
  roleConfirmationProgressSchema,
  roomCodeSchema,
  startReadinessSchema,
  takeoverRequestSchema
} from "./domain.js";
import {
  dawnResultSchema,
  gameResultSchema,
  privateDayVoteSchema,
  privateGuardActionSchema,
  privateHunterActionSchema,
  privateRoleSchema,
  privateSeerActionSchema,
  privateWitchActionSchema,
  privateWolfActionSchema,
  publicDayStateSchema
} from "./game.js";

export const hostLobbyViewSchema = lobbyViewBaseSchema.extend({
  joinUrl: z.url(),
  localAddress: z.string().min(1),
  takeoverRequests: z.array(takeoverRequestSchema),
  roleConfiguration: roleConfigurationSchema,
  startReadiness: startReadinessSchema,
  roleConfirmation: roleConfirmationProgressSchema,
  nightProgress: nightProgressSchema,
  dawnResult: z.object({
    deaths: z.array(lobbyPlayerSchema.pick({ id: true, number: true, nickname: true }))
  }).nullable(),
  dayState: publicDayStateSchema,
  gameResult: gameResultSchema
});
export type HostLobbyView = z.infer<typeof hostLobbyViewSchema>;

export const hostBootstrapSchema = z.object({
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  lobby: hostLobbyViewSchema
});
export type HostBootstrap = z.infer<typeof hostBootstrapSchema>;

export const playerLobbyViewSchema = lobbyViewBaseSchema.extend({
  selfId: playerIdSchema,
  privateRole: privateRoleSchema.nullable(),
  roleConfirmation: roleConfirmationProgressSchema,
  nightProgress: nightProgressSchema,
  wolfAction: privateWolfActionSchema.nullable(),
  seerAction: privateSeerActionSchema.nullable(),
  witchAction: privateWitchActionSchema.nullable(),
  guardAction: privateGuardActionSchema.nullable(),
  hunterAction: privateHunterActionSchema.nullable(),
  dawnResult: dawnResultSchema,
  dayState: publicDayStateSchema,
  dayVote: privateDayVoteSchema,
  gameResult: gameResultSchema
});
export type PlayerLobbyView = z.infer<typeof playerLobbyViewSchema>;

export const playerCredentialsSchema = z.object({
  roomCode: roomCodeSchema,
  playerId: playerIdSchema,
  reconnectToken: reconnectTokenSchema
});
export type PlayerCredentials = z.infer<typeof playerCredentialsSchema>;

export const playerSessionSchema = z.object({
  credentials: playerCredentialsSchema,
  lobby: playerLobbyViewSchema
});
export type PlayerSession = z.infer<typeof playerSessionSchema>;

export const joinLobbyRequestSchema = z.object({
  roomCode: roomCodeSchema,
  joinToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  nickname: nicknameSchema
});
export type JoinLobbyRequest = z.infer<typeof joinLobbyRequestSchema>;

export const reconnectPlayerRequestSchema = playerCredentialsSchema;
export type ReconnectPlayerRequest = z.infer<typeof reconnectPlayerRequestSchema>;

export const takeoverPlayerRequestSchema = joinLobbyRequestSchema.pick({
  roomCode: true,
  joinToken: true,
  nickname: true
});
export type TakeoverPlayerRequest = z.infer<typeof takeoverPlayerRequestSchema>;

export const takeoverReceiptSchema = z.object({
  requestId: z.uuid(),
  nickname: nicknameSchema
});
export type TakeoverReceipt = z.infer<typeof takeoverReceiptSchema>;
