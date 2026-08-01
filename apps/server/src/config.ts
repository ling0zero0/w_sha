import { z } from "zod";

const environmentSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(5173),
  WEB_ROOT: z.string().min(1).optional(),
  SOCKET_ALLOWED_ORIGINS: z.string().min(1).optional(),
  OPEN_BROWSER: z.enum(["0", "1"]).transform((value) => value === "1").default(false),
  PUBLIC_ADDRESS: z.string().min(1).optional(),
  DATABASE_PATH: z.string().min(1).default(".runtime/werewolf.sqlite"),
  AI_MASTER_KEY: z.string().min(1).optional(),
  AI_GAME_TOKEN_BUDGET: z.coerce.number().int().min(1).max(100_000_000).optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

export type ServerConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  return environmentSchema.parse(environment);
}
