import type { AppSurface } from "@werewolf/shared";

export function getSurface(pathname: string): AppSurface {
  return pathname === "/join" || pathname.startsWith("/join/") ? "player" : "host";
}

