import { joinTokenSchema, roomCodeSchema, type AppSurface, type JoinLobbyRequest } from "@werewolf/shared";

export function getSurface(pathname: string): AppSurface {
  return pathname === "/join" || pathname.startsWith("/join/") ? "player" : "host";
}

export function getJoinInvitation(location: Pick<Location, "pathname" | "search">): Omit<JoinLobbyRequest, "nickname"> | null {
  const roomCode = location.pathname.split("/")[2] ?? "";
  const joinToken = new URLSearchParams(location.search).get("t") ?? "";
  const parsedRoomCode = roomCodeSchema.safeParse(roomCode);
  const parsedJoinToken = joinTokenSchema.safeParse(joinToken);
  if (!parsedRoomCode.success || !parsedJoinToken.success) return null;
  return { roomCode: parsedRoomCode.data, joinToken: parsedJoinToken.data };
}
