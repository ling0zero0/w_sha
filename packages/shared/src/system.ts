import { z } from "zod";

export const appSurfaceSchema = z.enum(["host", "player"]);
export type AppSurface = z.infer<typeof appSurfaceSchema>;

export const serviceStatusSchema = z.object({
  name: z.literal("werewolf-lan-server"),
  version: z.string().min(1),
  status: z.literal("ok"),
  serverTime: z.iso.datetime()
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;

export const clientPingSchema = z.object({
  sentAt: z.number().int().nonnegative()
});
export type ClientPing = z.infer<typeof clientPingSchema>;

export const serverPongSchema = z.object({
  sentAt: z.number().int().nonnegative(),
  receivedAt: z.number().int().nonnegative()
});
export type ServerPong = z.infer<typeof serverPongSchema>;

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1)
});
export type ApiError = z.infer<typeof apiErrorSchema>;
