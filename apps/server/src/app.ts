import { apiErrorSchema, hostBootstrapSchema, serviceStatusSchema } from "@werewolf/shared";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyServerOptions } from "fastify";
import { resolve } from "node:path";
import { ZodError } from "zod";
import type { ServerConfig } from "./config.js";
import type { GameRuntime } from "./runtime.js";
import { registerAiAdminRoutes, type AiAdminServices } from "./ai/admin-ai-routes.js";

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

function isLoopbackBrowserSource(source: string | undefined): boolean {
  if (!source) return false;
  try {
    const hostname = new URL(source).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function getBrowserAddress(
  directAddress: string,
  proxyClientAddress: string | string[] | undefined
): string {
  if (!isLoopbackAddress(directAddress) || typeof proxyClientAddress !== "string") {
    return directAddress;
  }

  return proxyClientAddress;
}

export function buildServer(
  config: ServerConfig,
  runtime?: GameRuntime,
  aiServices?: AiAdminServices
) {
  const app = Fastify({ logger: loggerOptions(config) });

  if (config.WEB_ROOT) {
    void app.register(fastifyStatic, {
      root: resolve(config.WEB_ROOT),
      wildcard: false
    });
  }

  app.get("/health", async () => createServiceStatus());
  app.get("/api/bootstrap", async () => createServiceStatus());
  app.get("/api/host-bootstrap", async (request, reply) => {
    const browserSource = request.headers.origin ?? request.headers.referer;
    const browserAddress = getBrowserAddress(
      request.ip,
      request.headers["x-werewolf-proxy-client-ip"]
    );
    if (!runtime || !isLoopbackAddress(browserAddress) || !isLoopbackBrowserSource(browserSource)) {
      return reply.code(403).send(apiErrorSchema.parse({
        code: "HOST_LOCAL_ONLY",
        message: "主机控制台只能从本机打开",
        requestId: request.id
      }));
    }

    return hostBootstrapSchema.parse({
      sessionToken: runtime.hostSession,
      lobby: runtime.room.getHostView()
    });
  });

  if (runtime && aiServices) {
    registerAiAdminRoutes(app, runtime, aiServices);
  }

  app.setNotFoundHandler((request, reply) => {
    if (config.WEB_ROOT && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.sendFile("index.html", { maxAge: 0, immutable: false });
    }

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
