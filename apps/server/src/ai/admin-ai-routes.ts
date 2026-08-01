import {
  aiBotProfileIdSchema,
  aiModelProfileIdSchema,
  aiProviderIdSchema,
  apiErrorSchema,
  createAiBotProfileRequestSchema,
  createAiModelProfileRequestSchema,
  createAiProviderRequestSchema,
  updateAiBotProfileRequestSchema,
  updateAiModelProfileRequestSchema,
  updateAiProviderRequestSchema
} from "@werewolf/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { GameRuntime } from "../runtime.js";
import { isAuthorizedAiAdmin } from "./admin-ai-auth.js";
import type { AiAuditStore } from "./ai-audit-store.js";
import type { AiConfigStore } from "./ai-config-store.js";
import type { ProviderRegistry } from "./provider-registry.js";

export interface AiAdminServices {
  store: AiConfigStore;
  providers: ProviderRegistry;
  auditStore?: AiAuditStore;
}

export function registerAiAdminRoutes(
  app: FastifyInstance,
  runtime: GameRuntime,
  services: AiAdminServices
): void {
  void app.register(async (admin) => {
    admin.addHook("onRequest", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (isAuthorized(request, runtime.hostSession)) return;
      return reply.code(403).send(apiError(request, "AI_ADMIN_FORBIDDEN", "AI 管理页面只能由本机主持人访问"));
    });

    admin.get("/overview", async () => services.store.getConfiguration());

    admin.get("/providers", async () => services.store.listProviders());
    admin.post("/providers", async (request, reply) => execute(request, reply, () => {
      const input = createAiProviderRequestSchema.parse(request.body);
      return services.store.createProvider(input);
    }, 201));
    admin.patch("/providers/:id", async (request, reply) => execute(request, reply, () => {
      const id = parseProviderId(request.params);
      const input = updateAiProviderRequestSchema.parse(request.body);
      return services.store.updateProvider(id, input);
    }));
    admin.delete("/providers/:id", async (request, reply) => execute(request, reply, () => {
      services.store.deleteProvider(parseProviderId(request.params));
      return null;
    }, 204));
    admin.post("/providers/:id/test", async (request, reply) => execute(request, reply, async () => {
      const providerId = parseProviderId(request.params);
      const model = services.store.listModelProfiles()
        .find((candidate) => candidate.providerId === providerId);
      if (!model) throw new AiAdminRouteError(409, "AI_MODEL_REQUIRED", "请先为该服务连接创建模型配置");
      return testModelConnection(services, model.id, request.signal);
    }));

    admin.get("/models", async () => services.store.listModelProfiles());
    admin.post("/models", async (request, reply) => execute(request, reply, () => {
      const input = createAiModelProfileRequestSchema.parse(request.body);
      return services.store.createModelProfile(input);
    }, 201));
    admin.patch("/models/:id", async (request, reply) => execute(request, reply, () => {
      const id = parseModelId(request.params);
      const input = updateAiModelProfileRequestSchema.parse(request.body);
      return services.store.updateModelProfile(id, input);
    }));
    admin.delete("/models/:id", async (request, reply) => execute(request, reply, () => {
      services.store.deleteModelProfile(parseModelId(request.params));
      return null;
    }, 204));
    admin.post("/models/:id/test", async (request, reply) => execute(request, reply, () => {
      return testModelConnection(services, parseModelId(request.params), request.signal);
    }));

    admin.get("/bot-profiles", async () => services.store.listBotProfiles());
    admin.get("/usage", async () => ({
      attempts: services.auditStore?.listAttempts() ?? [],
      usage: services.auditStore?.listUsage() ?? []
    }));
    admin.post("/bot-profiles", async (request, reply) => execute(request, reply, () => {
      const input = createAiBotProfileRequestSchema.parse(request.body);
      return services.store.createBotProfile(input);
    }, 201));
    admin.patch("/bot-profiles/:id", async (request, reply) => execute(request, reply, () => {
      const id = parseBotProfileId(request.params);
      const input = updateAiBotProfileRequestSchema.parse(request.body);
      return services.store.updateBotProfile(id, input);
    }));
    admin.delete("/bot-profiles/:id", async (request, reply) => execute(request, reply, () => {
      services.store.deleteBotProfile(parseBotProfileId(request.params));
      return null;
    }, 204));
  }, { prefix: "/api/admin/ai" });
}

async function testModelConnection(
  services: AiAdminServices,
  modelId: string,
  signal: AbortSignal
) {
  const model = services.store.getModelProfile(modelId);
  if (!model) throw new AiAdminRouteError(404, "AI_MODEL_NOT_FOUND", "模型配置不存在");
  const provider = services.store.getProvider(model.providerId);
  if (!provider) throw new AiAdminRouteError(404, "AI_PROVIDER_NOT_FOUND", "服务连接不存在");
  const credential = services.store.getProviderCredential(provider.id);
  const adapter = services.providers.create(provider.protocol, {
    baseUrl: provider.baseUrl,
    apiKey: credential
  });
  const result = await adapter.testConnection(model, signal);
  if (!result.ok) {
    throw new AiAdminRouteError(
      providerErrorStatus(result.error.code),
      result.error.code,
      result.error.message
    );
  }
  return result;
}

async function execute(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => unknown | Promise<unknown>,
  successStatus = 200
) {
  try {
    const result = await operation();
    if (successStatus === 204) return reply.code(204).send();
    return reply.code(successStatus).send(result);
  } catch (error) {
    if (error instanceof ZodError) throw error;
    const mapped = mapRouteError(error);
    return reply.code(mapped.status).send(apiError(
      request,
      mapped.code,
      mapped.message
    ));
  }
}

function mapRouteError(error: unknown): AiAdminRouteError {
  if (error instanceof AiAdminRouteError) return error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not found")) {
    return new AiAdminRouteError(404, "AI_NOT_FOUND", "AI 配置不存在");
  }
  if (message.includes("secure secret box")) {
    return new AiAdminRouteError(
      503,
      "AI_MASTER_KEY_REQUIRED",
      "服务端尚未配置 AI_MASTER_KEY，无法安全保存或读取凭证"
    );
  }
  if (
    message.includes("referenced")
    || message.includes("fallback")
    || message.includes("UNIQUE constraint")
  ) {
    return new AiAdminRouteError(409, "AI_CONFIGURATION_CONFLICT", "AI 配置存在引用、重名或回退链冲突");
  }
  return new AiAdminRouteError(500, "AI_ADMIN_ERROR", "AI 管理操作失败");
}

function parseProviderId(params: unknown): string {
  return aiProviderIdSchema.parse(readId(params));
}

function parseModelId(params: unknown): string {
  return aiModelProfileIdSchema.parse(readId(params));
}

function parseBotProfileId(params: unknown): string {
  return aiBotProfileIdSchema.parse(readId(params));
}

function readId(params: unknown): unknown {
  return typeof params === "object" && params !== null && "id" in params
    ? params.id
    : undefined;
}

function isAuthorized(request: FastifyRequest, hostSession: string): boolean {
  return isAuthorizedAiAdmin({
    directAddress: request.ip,
    ...(request.headers["x-werewolf-proxy-client-ip"] === undefined
      ? {}
      : { proxyClientAddress: request.headers["x-werewolf-proxy-client-ip"] }),
    ...(request.headers.origin === undefined ? {} : { origin: request.headers.origin }),
    ...(request.headers.referer === undefined ? {} : { referer: request.headers.referer }),
    ...(request.headers.authorization === undefined
      ? {}
      : { authorization: request.headers.authorization })
  }, hostSession);
}

function apiError(
  request: FastifyRequest,
  code: string,
  message: string
) {
  return apiErrorSchema.parse({ code, message, requestId: request.id });
}

function providerErrorStatus(code: string): number {
  if (code === "AUTHENTICATION_FAILED") return 401;
  if (code === "MODEL_NOT_FOUND") return 404;
  if (code === "RATE_LIMITED") return 429;
  if (code === "TIMEOUT") return 504;
  return 502;
}

class AiAdminRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
