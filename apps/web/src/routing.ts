import { joinTokenSchema, roomCodeSchema, type JoinLobbyRequest } from "@werewolf/shared";

export type AppSurface = "host" | "player" | "ai" | "not-found";

export function getSurface(pathname: string): AppSurface {
  if (pathname === "/") return "host";
  if (pathname === "/ai" || pathname.startsWith("/ai/")) return "ai";
  if (pathname === "/join" || pathname.startsWith("/join/")) return "player";
  return "not-found";
}

export function getJoinInvitation(location: Pick<Location, "pathname" | "search">): Omit<JoinLobbyRequest, "nickname"> | null {
  const roomCode = location.pathname.split("/")[2] ?? "";
  const joinToken = new URLSearchParams(location.search).get("t") ?? "";
  const parsedRoomCode = roomCodeSchema.safeParse(roomCode);
  const parsedJoinToken = joinTokenSchema.safeParse(joinToken);
  if (!parsedRoomCode.success || !parsedJoinToken.success) return null;
  return { roomCode: parsedRoomCode.data, joinToken: parsedJoinToken.data };
}
