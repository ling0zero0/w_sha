import {
  aiBotProfileViewSchema,
  aiConfigurationViewSchema,
  aiModelProfileViewSchema,
  aiProviderViewSchema,
  apiErrorSchema,
  createAiBotProfileRequestSchema,
  createAiModelProfileRequestSchema,
  createAiProviderRequestSchema,
  hostBootstrapSchema,
  updateAiBotProfileRequestSchema,
  updateAiModelProfileRequestSchema,
  updateAiProviderRequestSchema,
  type AiBotProfileId,
  type AiBotProfileView,
  type AiConfigurationView,
  type AiModelProfileId,
  type AiModelProfileView,
  type AiProviderId,
  type AiProviderView,
  type CreateAiBotProfileRequest,
  type CreateAiModelProfileRequest,
  type CreateAiProviderRequest,
  type UpdateAiBotProfileRequest,
  type UpdateAiModelProfileRequest,
  type UpdateAiProviderRequest
} from "@werewolf/shared";

type Fetch = typeof fetch;
interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export class AiAdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AiAdminError";
  }
}

function safeMessage(payload: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(payload);
  return parsed.success ? parsed.data.message : fallback;
}

export function redactCredential(text: string, credential?: string): string {
  if (!credential) return text;
  return text.split(credential).join("[已隐藏]");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export interface AiAdminClient {
  getOverview(signal?: AbortSignal): Promise<AiConfigurationView>;
  createProvider(request: CreateAiProviderRequest): Promise<AiProviderView>;
  updateProvider(id: AiProviderId, request: UpdateAiProviderRequest): Promise<AiProviderView>;
  deleteProvider(id: AiProviderId): Promise<void>;
  testProvider(id: AiProviderId): Promise<void>;
  createModel(request: CreateAiModelProfileRequest): Promise<AiModelProfileView>;
  updateModel(id: AiModelProfileId, request: UpdateAiModelProfileRequest): Promise<AiModelProfileView>;
  deleteModel(id: AiModelProfileId): Promise<void>;
  testModel(id: AiModelProfileId): Promise<void>;
  createBotProfile(request: CreateAiBotProfileRequest): Promise<AiBotProfileView>;
  updateBotProfile(id: AiBotProfileId, request: UpdateAiBotProfileRequest): Promise<AiBotProfileView>;
  deleteBotProfile(id: AiBotProfileId): Promise<void>;
}

export function createAiAdminClient(fetchImplementation: Fetch = fetch): AiAdminClient {
  let sessionToken: string | null = null;

  async function getToken(signal?: AbortSignal): Promise<string> {
    if (sessionToken) return sessionToken;
    const response = await fetchImplementation("/api/host-bootstrap", {
      ...(signal ? { signal } : {})
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new AiAdminError(safeMessage(payload, "无法获取本地主机管理权限"), response.status);
    }
    sessionToken = hostBootstrapSchema.parse(payload).sessionToken;
    return sessionToken;
  }

  async function request<T>(
    path: string,
    schema: RuntimeSchema<T> | null,
    init: RequestInit = {},
    credential?: string
  ): Promise<T> {
    try {
      const token = await getToken(init.signal ?? undefined);
      const response = await fetchImplementation(`/api/admin/ai${path}`, {
        ...init,
        headers: {
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...init.headers,
          Authorization: `Bearer ${token}`
        }
      });
      const payload = response.status === 204 ? null : await readJson(response);
      if (!response.ok) {
        throw new AiAdminError(
          redactCredential(safeMessage(payload, "AI 管理请求失败"), credential),
          response.status
        );
      }
      return schema ? schema.parse(payload) : undefined as T;
    } catch (error) {
      if (error instanceof AiAdminError) throw error;
      const message = error instanceof Error ? error.message : "AI 管理请求失败";
      throw new AiAdminError(redactCredential(message, credential), 0);
    }
  }

  const json = (value: unknown) => JSON.stringify(value);

  return {
    getOverview: (signal) => request("/overview", aiConfigurationViewSchema, {
      ...(signal ? { signal } : {})
    }),
    createProvider: (value) => {
      const parsed = createAiProviderRequestSchema.parse(value);
      return request("/providers", aiProviderViewSchema, {
        method: "POST",
        body: json(parsed)
      }, parsed.apiKey);
    },
    updateProvider: (id, value) => {
      const parsed = updateAiProviderRequestSchema.parse(value);
      return request(`/providers/${id}`, aiProviderViewSchema, {
        method: "PATCH",
        body: json(parsed)
      }, parsed.apiKey);
    },
    deleteProvider: (id) => request(`/providers/${id}`, null, { method: "DELETE" }),
    testProvider: (id) => request(`/providers/${id}/test`, null, { method: "POST" }),
    createModel: (value) => request("/models", aiModelProfileViewSchema, {
      method: "POST",
      body: json(createAiModelProfileRequestSchema.parse(value))
    }),
    updateModel: (id, value) => request(`/models/${id}`, aiModelProfileViewSchema, {
      method: "PATCH",
      body: json(updateAiModelProfileRequestSchema.parse(value))
    }),
    deleteModel: (id) => request(`/models/${id}`, null, { method: "DELETE" }),
    testModel: (id) => request(`/models/${id}/test`, null, { method: "POST" }),
    createBotProfile: (value) => request("/bot-profiles", aiBotProfileViewSchema, {
      method: "POST",
      body: json(createAiBotProfileRequestSchema.parse(value))
    }),
    updateBotProfile: (id, value) => request(`/bot-profiles/${id}`, aiBotProfileViewSchema, {
      method: "PATCH",
      body: json(updateAiBotProfileRequestSchema.parse(value))
    }),
    deleteBotProfile: (id) => request(`/bot-profiles/${id}`, null, { method: "DELETE" })
  };
}
