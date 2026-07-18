import {
  hostBootstrapSchema,
  type ClientToServerEvents,
  type HostLobbyView,
  type PlayerId,
  type PublicGameState,
  type RoleConfiguration,
  type RoomActionResult,
  type ServerToClientEvents
} from "@werewolf/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

type ConnectionState = "checking" | "connected" | "disconnected";

interface HostLobbyState {
  api: ConnectionState;
  socket: ConnectionState;
  lobby: HostLobbyView | null;
  game: PublicGameState | null;
  error: string;
}

const initialState: HostLobbyState = {
  api: "checking",
  socket: "checking",
  lobby: null,
  game: null,
  error: ""
};

export function useHostLobby() {
  const [state, setState] = useState(initialState);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    void fetch("/api/host-bootstrap", { signal: abortController.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "主机控制台只能从本机打开" : "主机服务暂时不可用");
        return hostBootstrapSchema.parse(await response.json());
      })
      .then((bootstrap) => {
        if (abortController.signal.aborted) return;
        setState((current) => ({ ...current, api: "connected", lobby: bootstrap.lobby, error: "" }));

        const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
          auth: { hostSession: bootstrap.sessionToken },
          transports: ["websocket", "polling"]
        });
        socketRef.current = socket;
        socket.on("connect", () => setState((current) => ({ ...current, socket: "connected" })));
        socket.on("connect_error", () => setState((current) => ({ ...current, socket: "disconnected" })));
        socket.on("disconnect", () => setState((current) => ({ ...current, socket: "disconnected" })));
        socket.on("host:state", (lobby) => setState((current) => ({ ...current, lobby, error: "" })));
        socket.on("game:public-state", (game) => setState((current) => ({ ...current, game })));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => ({
          ...current,
          api: "disconnected",
          socket: "disconnected",
          error: error instanceof Error ? error.message : "主机服务暂时不可用"
        }));
      });

    return () => {
      abortController.abort();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const applyResult = useCallback((result: RoomActionResult<HostLobbyView>) => {
    if (result.ok) {
      setState((current) => ({ ...current, lobby: result.data, error: "" }));
    } else {
      setState((current) => ({ ...current, error: result.message }));
    }
  }, []);

  const applyGameResult = useCallback((result: RoomActionResult<PublicGameState>) => {
    if (result.ok) {
      setState((current) => ({ ...current, game: result.data, error: "" }));
    } else {
      setState((current) => ({ ...current, error: result.message }));
    }
  }, []);

  const refreshJoin = useCallback(() => {
    socketRef.current?.emit("host:refresh-join", applyResult);
  }, [applyResult]);

  const movePlayer = useCallback((playerId: PlayerId, direction: "up" | "down") => {
    socketRef.current?.emit("host:move-player", { playerId, direction }, applyResult);
  }, [applyResult]);

  const removePlayer = useCallback((playerId: PlayerId) => {
    socketRef.current?.emit("host:remove-player", { playerId }, applyResult);
  }, [applyResult]);

  const correctPlayerLife = useCallback((playerId: PlayerId, alive: boolean) => {
    socketRef.current?.emit("host:correct-player-life", { playerId, alive }, applyResult);
  }, [applyResult]);

  const resolveTakeover = useCallback((requestId: string, approved: boolean) => {
    socketRef.current?.emit("host:resolve-takeover", { requestId, approved }, applyResult);
  }, [applyResult]);

  const pausePhase = useCallback(() => {
    socketRef.current?.emit("host:pause-phase", applyGameResult);
  }, [applyGameResult]);

  const resumePhase = useCallback(() => {
    socketRef.current?.emit("host:resume-phase", applyGameResult);
  }, [applyGameResult]);

  const adjustPhaseTime = useCallback((deltaMs: number) => {
    socketRef.current?.emit("host:adjust-phase-time", { deltaMs }, applyGameResult);
  }, [applyGameResult]);

  const forceEndPhase = useCallback(() => {
    socketRef.current?.emit("host:force-end-phase", applyGameResult);
  }, [applyGameResult]);

  const skipNightPhase = useCallback(() => {
    socketRef.current?.emit("host:skip-night-phase", applyGameResult);
  }, [applyGameResult]);

  const updateRoleConfiguration = useCallback((configuration: RoleConfiguration) => {
    socketRef.current?.emit("host:update-role-configuration", configuration, applyResult);
  }, [applyResult]);

  const startGame = useCallback(() => {
    socketRef.current?.emit("host:start-game", applyResult);
  }, [applyResult]);

  const continueFromDawn = useCallback(() => {
    socketRef.current?.emit("host:continue-from-dawn", applyResult);
  }, [applyResult]);

  const continueFromExile = useCallback(() => {
    socketRef.current?.emit("host:continue-from-exile", applyResult);
  }, [applyResult]);

  const skipDayPhase = useCallback(() => {
    socketRef.current?.emit("host:skip-day-phase", applyGameResult);
  }, [applyGameResult]);

  const playAgain = useCallback(() => {
    socketRef.current?.emit("host:play-again", applyResult);
  }, [applyResult]);

  const returnToLobby = useCallback(() => {
    socketRef.current?.emit("host:return-to-lobby", applyResult);
  }, [applyResult]);

  return {
    ...state,
    refreshJoin,
    movePlayer,
    removePlayer,
    correctPlayerLife,
    resolveTakeover,
    pausePhase,
    resumePhase,
    adjustPhaseTime,
    forceEndPhase,
    skipNightPhase,
    updateRoleConfiguration,
    startGame,
    continueFromDawn,
    continueFromExile,
    skipDayPhase,
    playAgain,
    returnToLobby
  };
}
