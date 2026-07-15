import { apiErrorSchema, serviceStatusSchema } from "@werewolf/shared";
import Fastify, { type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import type { ServerConfig } from "./config.js";

const serviceVersion = "0.1.0";

export function createServiceStatus(now = new Date()) {
  return serviceStatusSchema.parse({
    name: "werewolf-lan-server",
    version: serviceVersion,
    status: "ok",
    serverTime: now.toISOString()
  });
}

type LoggerOption = Exclude<FastifyServerOptions["logger"], undefined>;

function loggerOptions(config: ServerConfig): LoggerOption {
  if (config.NODE_ENV === "test" || config.LOG_LEVEL === "silent") {
    return false;
  }

  if (config.NODE_ENV === "development") {
    return {
      level: config.LOG_LEVEL,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" }
      }
    };
  }

  return { level: config.LOG_LEVEL };
}

export function buildServer(config: ServerConfig) {
  const app = Fastify({ logger: loggerOptions(config) });

  app.get("/health", async () => createServiceStatus());
  app.get("/api/bootstrap", async () => createServiceStatus());

  app.setNotFoundHandler((request, reply) => {
    const payload = apiErrorSchema.parse({
      code: "NOT_FOUND",
      message: "请求的资源不存在",
      requestId: request.id
    });

    return reply.code(404).send(payload);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");

    const payload = apiErrorSchema.parse({
      code: error instanceof ZodError ? "INVALID_REQUEST" : "INTERNAL_ERROR",
      message: error instanceof ZodError ? "请求数据无效" : "服务暂时不可用",
      requestId: request.id
    });

    return reply.code(error instanceof ZodError ? 400 : 500).send(payload);
  });

  return app;
}
