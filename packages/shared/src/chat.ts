import { z } from "zod";
import { nicknameSchema, playerIdSchema, roomPhaseSchema } from "./domain.js";

export const chatChannelSchema = z.enum(["day-public", "wolf-private", "system"]);
export type ChatChannel = z.infer<typeof chatChannelSchema>;

const participantChatSenderSchema = z.object({
  kind: z.enum(["player", "bot"]),
  id: playerIdSchema,
  number: z.number().int().positive(),
  nickname: nicknameSchema
});

const systemChatSenderSchema = z.object({
  kind: z.literal("system"),
  label: z.string().trim().min(1).max(24)
});

export const chatSenderSchema = z.union([participantChatSenderSchema, systemChatSenderSchema]);
export type ChatSender = z.infer<typeof chatSenderSchema>;

export const chatTextContentSchema = z.object({
  kind: z.literal("text"),
  text: z.string().trim().min(1).max(200)
});

export const chatQuickContentSchema = z.object({
  kind: z.literal("quick"),
  code: z.enum(["agree", "disagree", "no-kill"])
});

export const chatTargetSuggestionContentSchema = z.object({
  kind: z.literal("target-suggestion"),
  target: z.object({
    id: playerIdSchema,
    number: z.number().int().positive(),
    nickname: nicknameSchema
  })
});

export const chatSystemContentSchema = z.object({
  kind: z.literal("system"),
  text: z.string().trim().min(1).max(200)
});

export const chatContentSchema = z.discriminatedUnion("kind", [
  chatTextContentSchema,
  chatQuickContentSchema,
  chatTargetSuggestionContentSchema,
  chatSystemContentSchema
]);
export type ChatContent = z.infer<typeof chatContentSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  channel: chatChannelSchema,
  day: z.number().int().positive(),
  phase: roomPhaseSchema,
  sender: chatSenderSchema,
  content: chatContentSchema,
  createdAt: z.iso.datetime()
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatViewSchema = z.object({
  canSend: z.boolean(),
  messages: z.array(chatMessageSchema)
});
export type ChatView = z.infer<typeof chatViewSchema>;

export const gameSessionIdSchema = z.uuid();
export type GameSessionId = z.infer<typeof gameSessionIdSchema>;

export const chatHistoryRequestSchema = z.object({
  afterSequence: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(100)
}).strict();
export type ChatHistoryRequest = z.infer<typeof chatHistoryRequestSchema>;

export const chatHistoryPageSchema = z.object({
  sessionId: gameSessionIdSchema,
  messages: z.array(chatMessageSchema),
  latestSequence: z.number().int().nonnegative(),
  hasMore: z.boolean()
}).strict();
export type ChatHistoryPage = z.infer<typeof chatHistoryPageSchema>;
