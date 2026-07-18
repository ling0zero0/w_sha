import type { RoleConfiguration } from "@werewolf/shared";

export const roleLabels: Record<keyof RoleConfiguration, string> = {
  wolf: "狼人",
  villager: "村民",
  seer: "预言家",
  witch: "女巫"
};

export const roleImages: Record<keyof RoleConfiguration, string> = {
  wolf: "/assets/roles/wolf.png",
  villager: "/assets/roles/villager.png",
  seer: "/assets/roles/seer.png",
  witch: "/assets/roles/witch.png"
};

export const outcomeLabels = {
  "good-win": "好人胜利",
  "wolf-win": "狼人胜利",
  draw: "平局",
  terminated: "对局终止"
} as const;
