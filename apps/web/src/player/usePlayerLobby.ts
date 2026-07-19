import {
  playerCredentialsSchema,
  type ClientToServerEvents,
  type JoinLobbyRequest,
  type PlayerCredentials,
  type PlayerLobbyView,
  type PlayerSession,
  type PublicGameState,
  type RoomActionResult,
  type ServerToClientEvents,
  type WolfVoteTarget
} from "@werewolf/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

interface PlayerLobbyState {
  socket: "checking" | "connected" | "disconnected";
  lobby: PlayerLobbyView | null;
  game: PublicGameState | null;
  joining: boolean;
  restoring: boolean;
  canRequestTakeover: boolean;
  takeoverPending: boolean;
  error: string;
  removed: boolean;
  replaced: boolean;
}

const initialState: PlayerLobbyState = {
  socket: "checking",
  lobby: null,
  game: null,
  joining: false,
  restoring: false,
  canRequestTakeover: false,
  takeoverPending: false,
  error: "",
  removed: false,
  replaced: false
};

function storageKey(roomCode: string): string {
  return `werewolf-lan:player:${roomCode}`;
}

function loadCredentials(roomCode: string): PlayerCredentials | null {
  try {
    const raw = window.localStorage.getItem(storageKey(roomCode));
    if (!raw) return null;
    return playerCredentialsSchema.parse(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(storageKey(roomCode));
    return null;
  }
}

function saveSession(session: PlayerSession): void {
  window.localStorage.setItem(storageKey(session.credentials.roomCode), JSON.stringify(session.credentials));
}

function clearCredentials(roomCode: string): void {
  window.localStorage.removeItem(storageKey(roomCode));
}

export function usePlayerLobby(invitation: Omit<JoinLobbyRequest, "nickname"> | null) {
  const [state, setState] = useState(initialState);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const credentialsRef = useRef<PlayerCredentials | null>(invitation ? loadCredentials(invitation.roomCode) : null);
  const lastNicknameRef = useRef("");

  useEffect(() => {
    if (!invitation) return;

    const applySession = (session: PlayerSession) => {
      credentialsRef.current = session.credentials;
      saveSession(session);
      setState((current) => ({
        ...current,
        lobby: session.lobby,
        joining: false,
        restoring: false,
        canRequestTakeover: false,
        takeoverPending: false,
        removed: false,
        replaced: false,
        error: ""
      }));
    };

    const restore = (socket: Socket<ServerToClientEvents, ClientToServerEvents>) => {
      const credentials = credentialsRef.current;
      if (!credentials || credentials.roomCode !== invitation.roomCode) return;
      setState((current) => ({ ...current, restoring: true, error: "" }));
      socket.emit("player:reconnect", credentials, (result) => {
        if (result.ok) {
          applySession(result.data);
          return;
        }
        clearCredentials(invitation.roomCode);
        credentialsRef.current = null;
        setState((current) => ({
          ...current,
          lobby: null,
          restoring: false,
          error: "原设备凭证已失效，请重新加入或申请接管"
        }));
      });
    };

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setState((current) => ({ ...current, socket: "connected", error: "" }));
      restore(socket);
    });
    socket.on("connect_error", () => setState((current) => ({ ...current, socket: "disconnected" })));
    socket.on("disconnect", () => setState((current) => ({ ...current, socket: "disconnected" })));
    socket.on("player:state", (lobby) => setState((current) => ({ ...current, lobby })));
    socket.on("game:public-state", (game) => setState((current) => ({ ...current, game })));
    socket.on("player:removed", ({ message }) => {
      clearCredentials(invitation.roomCode);
      credentialsRef.current = null;
      setState((current) => ({ ...current, lobby: null, game: null, removed: true, error: message }));
    });
    socket.on("player:session-replaced", ({ message }) => {
      clearCredentials(invitation.roomCode);
      credentialsRef.current = null;
      setState((current) => ({ ...current, lobby: null, game: null, replaced: true, error: message }));
    });
    socket.on("player:takeover-approved", applySession);
    socket.on("player:takeover-rejected", ({ message }) => {
      setState((current) => ({ ...current, takeoverPending: false, error: message }));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [invitation]);

  const join = useCallback((nickname: string) => {
    const socket = socketRef.current;
    if (!socket || !invitation) return;
    if (!socket.connected) {
      setState((current) => ({ ...current, error: "尚未连接到主机" }));
      return;
    }

    lastNicknameRef.current = nickname.trim();
    setState((current) => ({ ...current, joining: true, canRequestTakeover: false, error: "" }));
    socket.emit("player:join", { ...invitation, nickname }, (result) => {
      if (result.ok) {
        credentialsRef.current = result.data.credentials;
        saveSession(result.data);
        setState((current) => ({ ...current, joining: false, lobby: result.data.lobby, error: "" }));
      } else {
        setState((current) => ({
          ...current,
          joining: false,
          canRequestTakeover: result.code === "NICKNAME_TAKEN",
          error: result.message
        }));
      }
    });
  }, [invitation]);

  const requestTakeover = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !invitation || !lastNicknameRef.current) return;
    setState((current) => ({ ...current, takeoverPending: true, canRequestTakeover: false, error: "" }));
    socket.emit("player:request-takeover", {
      ...invitation,
      nickname: lastNicknameRef.current
    }, (result) => {
      if (result.ok) {
        setState((current) => ({ ...current, error: "接管申请已发送，请等待主机批准" }));
      } else {
        setState((current) => ({ ...current, takeoverPending: false, error: result.message }));
      }
    });
  }, [invitation]);

  const confirmRole = useCallback(() => {
    socketRef.current?.emit("player:confirm-role", (result) => {
      if (result.ok) {
        setState((current) => ({ ...current, lobby: result.data, error: "" }));
      } else {
        setState((current) => ({ ...current, error: result.message }));
      }
    });
  }, []);

  const applyPlayerView = useCallback((result: RoomActionResult<PlayerLobbyView>) => {
    if (result.ok) {
      setState((current) => ({ ...current, lobby: result.data, error: "" }));
    } else {
      setState((current) => ({ ...current, error: result.message }));
    }
  }, []);

  const selectWolfTarget = useCallback((target: WolfVoteTarget) => {
    socketRef.current?.emit("wolf:select-target", { target }, applyPlayerView);
  }, [applyPlayerView]);

  const confirmWolfVote = useCallback((confirmed: boolean) => {
    socketRef.current?.emit("wolf:confirm-vote", { confirmed }, applyPlayerView);
  }, [applyPlayerView]);

  const sendWolfMessage = useCallback((payload: Parameters<ClientToServerEvents["wolf:send-message"]>[0]) => {
    socketRef.current?.emit("wolf:send-message", payload, applyPlayerView);
  }, [applyPlayerView]);

  const inspectAsSeer = useCallback((target: string) => {
    socketRef.current?.emit("seer:inspect", { target }, applyPlayerView);
  }, [applyPlayerView]);

  const submitWitchAction = useCallback((action: "none" | "save" | "poison", target?: string) => {
    if (action === "poison" && target) {
      socketRef.current?.emit("witch:submit-action", { action, target }, applyPlayerView);
      return;
    }
    if (action !== "poison") socketRef.current?.emit("witch:submit-action", { action }, applyPlayerView);
  }, [applyPlayerView]);

  const protectAsGuard = useCallback((target: string | null) => {
    socketRef.current?.emit("guard:protect", { target }, applyPlayerView);
  }, [applyPlayerView]);

  const shootAsHunter = useCallback((target: string | null) => {
    socketRef.current?.emit("hunter:shoot", { target }, applyPlayerView);
  }, [applyPlayerView]);

  const finishSpeaking = useCallback(() => {
    socketRef.current?.emit("player:finish-speaking", applyPlayerView);
  }, [applyPlayerView]);

  const selectDayVote = useCallback((target: string | "abstain" | null) => {
    socketRef.current?.emit("day:select-vote", { target }, applyPlayerView);
  }, [applyPlayerView]);

  const confirmDayVote = useCallback((confirmed: boolean) => {
    socketRef.current?.emit("day:confirm-vote", { confirmed }, applyPlayerView);
  }, [applyPlayerView]);

  return {
    ...state,
    join,
    requestTakeover,
    confirmRole,
    selectWolfTarget,
    confirmWolfVote,
    sendWolfMessage,
    inspectAsSeer,
    submitWitchAction,
    protectAsGuard,
    shootAsHunter,
    finishSpeaking,
    selectDayVote,
    confirmDayVote
  };
}
