import { z } from "zod";
import {
  chatSendRequestSchema,
  dayConfirmVoteRequestSchema,
  daySelectVoteRequestSchema,
  guardProtectRequestSchema,
  hunterShootRequestSchema,
  seerInspectRequestSchema,
  witchSubmitActionRequestSchema,
  wolfConfirmVoteRequestSchema,
  wolfSelectTargetRequestSchema
} from "./actions.js";
import { aiBotProfileIdSchema } from "./ai.js";
import { nicknameSchema } from "./domain.js";

export const hostAddBotRequestSchema = z.discriminatedUnion("botKind", [
  z.object({
    nickname: nicknameSchema,
    botKind: z.literal("deterministic")
  }).strict(),
  z.object({
    nickname: nicknameSchema,
    botKind: z.literal("llm"),
    botProfileId: aiBotProfileIdSchema
  }).strict()
]);
export type HostAddBotRequest = z.infer<typeof hostAddBotRequestSchema>;

export const botIntentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("confirm-role")
  }).strict(),
  z.object({
    type: z.literal("wolf-select-target"),
    payload: wolfSelectTargetRequestSchema
  }).strict(),
  z.object({
    type: z.literal("wolf-confirm-vote"),
    payload: wolfConfirmVoteRequestSchema
  }).strict(),
  z.object({
    type: z.literal("chat-send"),
    payload: chatSendRequestSchema
  }).strict(),
  z.object({
    type: z.literal("seer-inspect"),
    payload: seerInspectRequestSchema
  }).strict(),
  z.object({
    type: z.literal("witch-submit-action"),
    payload: witchSubmitActionRequestSchema
  }).strict(),
  z.object({
    type: z.literal("guard-protect"),
    payload: guardProtectRequestSchema
  }).strict(),
  z.object({
    type: z.literal("hunter-shoot"),
    payload: hunterShootRequestSchema
  }).strict(),
  z.object({
    type: z.literal("finish-speaking")
  }).strict(),
  z.object({
    type: z.literal("day-select-vote"),
    payload: daySelectVoteRequestSchema
  }).strict(),
  z.object({
    type: z.literal("day-confirm-vote"),
    payload: dayConfirmVoteRequestSchema
  }).strict()
]);
export type BotIntent = z.infer<typeof botIntentSchema>;
