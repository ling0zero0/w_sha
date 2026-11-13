import type { GameResult, RoomPhase } from "@werewolf/shared";
import { useEffect } from "react";
import { sceneForPhase, type SceneKey } from "../game/scene-map";

/**
 * 把当前阶段写到 <html data-scene>，供 CSS 选择该阶段的村庄背景。
 * 用根节点属性而不是额外 DOM 层，避免影响层叠顺序、触控命中与窄屏溢出审计。
 */
export function useScene(phase: RoomPhase | null | undefined, result?: GameResult | null): SceneKey {
  const scene = sceneForPhase(phase, result?.outcome ?? null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.scene = scene;
    return () => {
      root.removeAttribute("data-scene");
    };
  }, [scene]);

  return scene;
}
