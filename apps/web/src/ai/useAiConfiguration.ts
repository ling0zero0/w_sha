import type { AiConfigurationView } from "@werewolf/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createAiAdminClient } from "./ai-client";

export type LoadState = "loading" | "ready" | "error";

export function useAiConfiguration() {
  const client = useMemo(() => createAiAdminClient(), []);
  const [configuration, setConfiguration] = useState<AiConfigurationView>({
    providers: [],
    models: [],
    botProfiles: []
  });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState("loading");
    setLoadError("");
    try {
      const next = await client.getOverview(signal);
      if (signal?.aborted) return;
      setConfiguration(next);
      setLoadState("ready");
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof Error ? error.message : "无法加载 AI 配置");
      setLoadState("error");
    }
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return {
    client,
    configuration,
    loadState,
    loadError,
    reload: () => load()
  };
}
