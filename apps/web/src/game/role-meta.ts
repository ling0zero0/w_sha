import type { Role } from "@werewolf/shared";

export const roleLabels: Record<Role, string> = {
  wolf: "狼人",
  villager: "村民",
  seer: "预言家",
  witch: "女巫",
  guard: "守卫",
  hunter: "猎人",
  idiot: "白痴"
};

export const roleImages: Record<Role, string | null> = {
  wolf: "/assets/roles/wolf.png",
  villager: "/assets/roles/villager.png",
  seer: "/assets/roles/seer.png",
  witch: "/assets/roles/witch.png",
  guard: "/assets/roles/guard.png",
  hunter: "/assets/roles/hunter.png",
  idiot: "/assets/roles/idiot.png"
};

export const outcomeLabels = {
  "good-win": "好人胜利",
  "wolf-win": "狼人胜利",
  draw: "平局",
  terminated: "对局终止"
} as const;
