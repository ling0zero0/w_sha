import {
  playerCredentialsSchema,
  type ActionId,
  type ChatMessage,
  type ChatSendRequest,
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
import { createActionId } from "../socket/action-id";

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

interface PendingLifecycleAction {
  actionId: ActionId;
  nickname: string;
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

function appendMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return mergeMessages(messages, [message]);
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!messages.has(message.id)) messages.set(message.id, message);
  }
  return [...messages.values()].sort((left, right) => left.sequence - right.sequence);
}

function lastLobbySequence(lobby: PlayerLobbyView): number {
  return [...lobby.publicChat.messages, ...(lobby.wolfAction?.messages ?? [])]
    .reduce((latest, message) => Math.max(latest, message.sequence), 0);
}

function appendChatMessage(lobby: PlayerLobbyView, message: ChatMessage): PlayerLobbyView {
  if (message.channel === "day-public" || message.channel === "system") {
    return {
      ...lobby,
      publicChat: {
        ...lobby.publicChat,
        messages: appendMessage(lobby.publicChat.messages, message)
      }
    };
  }
  if (message.channel === "wolf-private" && lobby.wolfAction) {
    return {
      ...lobby,
      wolfAction: {
        ...lobby.wolfAction,
        messages: appendMessage(lobby.wolfAction.messages, message)
      }
    };
  }
  return lobby;
}

export function usePlayerLobby(invitation: Omit<JoinLobbyRequest, "nickname"> | null) {
  const [state, setState] = useState(initialState);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const credentialsRef = useRef<PlayerCredentials | null>(invitation ? loadCredentials(invitation.roomCode) : null);
  const lastNicknameRef = useRef("");
  const joinActionRef = useRef<PendingLifecycleAction | null>(null);
  const reconnectActionRef = useRef<ActionId | null>(null);
  const takeoverActionRef = useRef<PendingLifecycleAction | null>(null);
  const chatSessionRef = useRef<string | null>(null);
  const chatCursorRef = useRef(0);
  const replayLoadedRef = useRef(false);

  const clearLifecycleActions = () => {
    joinActionRef.current = null;
    reconnectActionRef.current = null;
    takeoverActionRef.current = null;
  };

  useEffect(() => {
    clearLifecycleActions();
    if (!invitation) return;

    const resetChatHistory = () => {
      chatSessionRef.current = null;
      chatCursorRef.current = 0;
      replayLoadedRef.current = false;
    };

    const mergeHistory = (messages: ChatMessage[], clearExisting: boolean) => {
      setState((current) => {
        if (!current.lobby) return current;
        const publicMessages = messages.filter(
          (message) => message.channel === "day-public" || message.channel === "system"
        );
        const wolfMessages = messages.filter((message) => message.channel === "wolf-private");
        return {
          ...current,
          lobby: {
            ...current.lobby,
            publicChat: {
              ...current.lobby.publicChat,
              messages: mergeMessages(
                clearExisting ? [] : current.lobby.publicChat.messages,
                publicMessages
              )
            },
            wolfAction: current.lobby.wolfAction
              ? {
                  ...current.lobby.wolfAction,
                  messages: mergeMessages(
                    clearExisting ? [] : current.lobby.wolfAction.messages,
                    wolfMessages
                  )
                }
              : null
          }
        };
      });
    };

    const requestHistory = (
      socket: Socket<ServerToClientEvents, ClientToServerEvents>,
      view: PlayerLobbyView,
      fromStart = false
    ) => {
      if (view.phase === "lobby" || (fromStart && replayLoadedRef.current)) return;
      const initialAfterSequence = fromStart
        ? 0
        : Math.max(chatCursorRef.current, lastLobbySequence(view));

      const requestPage = (afterSequence: number, clearExisting: boolean) => {
        socket.emit("chat:history", { afterSequence, limit: 100 }, (result) => {
          if (!result.ok) {
            setState((current) => ({ ...current, error: result.message }));
            return;
          }

          const sessionChanged = chatSessionRef.current !== null
            && chatSessionRef.current !== result.data.sessionId;
          chatSessionRef.current = result.data.sessionId;
          if (sessionChanged && afterSequence > 0) {
            chatCursorRef.current = 0;
            replayLoadedRef.current = false;
            mergeHistory([], true);
            requestPage(0, true);
            return;
          }

          mergeHistory(result.data.messages, clearExisting || sessionChanged);
          const pageCursor = result.data.messages.at(-1)?.sequence ?? afterSequence;
          chatCursorRef.current = result.data.hasMore
            ? pageCursor
            : Math.max(pageCursor, result.data.latestSequence);

          if (result.data.hasMore) {
            requestPage(pageCursor, false);
          } else if (fromStart) {
            replayLoadedRef.current = true;
          }
        });
      };

      requestPage(initialAfterSequence, fromStart);
    };

    const applyLobbyView = (
      socket: Socket<ServerToClientEvents, ClientToServerEvents>,
      lobby: PlayerLobbyView
    ) => {
      setState((current) => {
        const startsNewView = lobby.phase === "lobby"
          || (current.lobby?.phase === "game-over" && lobby.phase !== "game-over");
        if (startsNewView) resetChatHistory();
        return {
          ...current,
          lobby: startsNewView || !current.lobby
            ? lobby
            : {
                ...lobby,
                publicChat: {
                  ...lobby.publicChat,
                  messages: mergeMessages(
                    current.lobby.publicChat.messages,
                    lobby.publicChat.messages
                  )
                },
                wolfAction: lobby.wolfAction
                  ? {
                      ...lobby.wolfAction,
                      messages: mergeMessages(
                        current.lobby.wolfAction?.messages ?? [],
                        lobby.wolfAction.messages
                      )
                    }
                  : null
              }
        };
      });
      requestHistory(socket, lobby, lobby.phase === "game-over");
    };

    const applySession = (session: PlayerSession) => {
      clearLifecycleActions();
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
      const activeSocket = socketRef.current;
      if (activeSocket) requestHistory(activeSocket, session.lobby, session.lobby.phase === "game-over");
    };

    const restore = (socket: Socket<ServerToClientEvents, ClientToServerEvents>) => {
      const credentials = credentialsRef.current;
      if (!credentials || credentials.roomCode !== invitation.roomCode) return;
      setState((current) => ({ ...current, restoring: true, error: "" }));
      const actionId = reconnectActionRef.current ?? createActionId();
      reconnectActionRef.current = actionId;
      socket.emit("player:reconnect", { ...credentials, actionId }, (result) => {
        if (reconnectActionRef.current === actionId) reconnectActionRef.current = null;
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
    socket.on("player:state", (lobby) => applyLobbyView(socket, lobby));
    socket.on("game:public-state", (game) => setState((current) => ({ ...current, game })));
    socket.on("chat:message", (message) => {
      chatCursorRef.current = Math.max(chatCursorRef.current, message.sequence);
      setState((current) => ({
        ...current,
        lobby: current.lobby ? appendChatMessage(current.lobby, message) : null
      }));
    });
    socket.on("player:removed", ({ message }) => {
      clearLifecycleActions();
      clearCredentials(invitation.roomCode);
      credentialsRef.current = null;
      setState((current) => ({ ...current, lobby: null, game: null, removed: true, error: message }));
    });
    socket.on("player:session-replaced", ({ message }) => {
      clearLifecycleActions();
      clearCredentials(invitation.roomCode);
      credentialsRef.current = null;
      setState((current) => ({ ...current, lobby: null, game: null, replaced: true, error: message }));
    });
    socket.on("player:takeover-approved", applySession);
    socket.on("player:takeover-rejected", ({ message }) => {
      takeoverActionRef.current = null;
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

    const normalizedNickname = nickname.trim();
    lastNicknameRef.current = normalizedNickname;
    const actionId = joinActionRef.current?.nickname === normalizedNickname
      ? joinActionRef.current.actionId
      : createActionId();
    joinActionRef.current = { actionId, nickname: normalizedNickname };
    setState((current) => ({ ...current, joining: true, canRequestTakeover: false, error: "" }));
    socket.emit("player:join", { ...invitation, nickname, actionId }, (result) => {
      if (joinActionRef.current?.actionId === actionId) joinActionRef.current = null;
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
    const nickname = lastNicknameRef.current;
    const actionId = takeoverActionRef.current?.nickname === nickname
      ? takeoverActionRef.current.actionId
      : createActionId();
    takeoverActionRef.current = { actionId, nickname };
    setState((current) => ({ ...current, takeoverPending: true, canRequestTakeover: false, error: "" }));
    socket.emit("player:request-takeover", {
      ...invitation,
      nickname,
      actionId
    }, (result) => {
      if (result.ok) {
        setState((current) => ({ ...current, error: "接管申请已发送，请等待主机批准" }));
      } else {
        if (takeoverActionRef.current?.actionId === actionId) takeoverActionRef.current = null;
        setState((current) => ({ ...current, takeoverPending: false, error: result.message }));
      }
    });
  }, [invitation]);

  const confirmRole = useCallback(() => {
    socketRef.current?.emit("player:confirm-role", { actionId: createActionId() }, (result) => {
      if (result.ok) {
        setState((current) => ({ ...current, lobby: result.data, error: "" }));
      } else {
        setState((current) => ({ ...current, error: result.message }));
      }
    });
  }, []);

  const applyPlayerView = useCallback((result: RoomActionResult<PlayerLobbyView>) => {
    if (result.ok) {
      setState((current) => {
        const startsNewView = result.data.phase === "lobby"
          || (current.lobby?.phase === "game-over" && result.data.phase !== "game-over");
        return {
          ...current,
          lobby: startsNewView || !current.lobby
            ? result.data
            : {
                ...result.data,
                publicChat: {
                  ...result.data.publicChat,
                  messages: mergeMessages(
                    current.lobby.publicChat.messages,
                    result.data.publicChat.messages
                  )
                },
                wolfAction: result.data.wolfAction
                  ? {
                      ...result.data.wolfAction,
                      messages: mergeMessages(
                        current.lobby.wolfAction?.messages ?? [],
                        result.data.wolfAction.messages
                      )
                    }
                  : null
              },
          error: ""
        };
      });
    } else {
      setState((current) => ({ ...current, error: result.message }));
    }
  }, []);

  const selectWolfTarget = useCallback((target: WolfVoteTarget) => {
    socketRef.current?.emit("wolf:select-target", { target, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const confirmWolfVote = useCallback((confirmed: boolean) => {
    socketRef.current?.emit("wolf:confirm-vote", { confirmed, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const sendChatMessage = useCallback((payload: ChatSendRequest) => {
    socketRef.current?.emit("chat:send", { ...payload, actionId: createActionId() }, (result) => {
      if (!result.ok) setState((current) => ({ ...current, error: result.message }));
    });
  }, []);

  const inspectAsSeer = useCallback((target: string) => {
    socketRef.current?.emit("seer:inspect", { target, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const submitWitchAction = useCallback((action: "none" | "save" | "poison", target?: string) => {
    if (action === "poison" && target) {
      socketRef.current?.emit("witch:submit-action", { action, target, actionId: createActionId() }, applyPlayerView);
      return;
    }
    if (action !== "poison") {
      socketRef.current?.emit("witch:submit-action", { action, actionId: createActionId() }, applyPlayerView);
    }
  }, [applyPlayerView]);

  const protectAsGuard = useCallback((target: string | null) => {
    socketRef.current?.emit("guard:protect", { target, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const shootAsHunter = useCallback((target: string | null) => {
    socketRef.current?.emit("hunter:shoot", { target, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const finishSpeaking = useCallback(() => {
    socketRef.current?.emit("player:finish-speaking", { actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const selectDayVote = useCallback((target: string | "abstain" | null) => {
    socketRef.current?.emit("day:select-vote", { target, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  const confirmDayVote = useCallback((confirmed: boolean) => {
    socketRef.current?.emit("day:confirm-vote", { confirmed, actionId: createActionId() }, applyPlayerView);
  }, [applyPlayerView]);

  return {
    ...state,
    join,
    requestTakeover,
    confirmRole,
    selectWolfTarget,
    confirmWolfVote,
    sendChatMessage,
    inspectAsSeer,
    submitWitchAction,
    protectAsGuard,
    shootAsHunter,
    finishSpeaking,
    selectDayVote,
    confirmDayVote
  };
}
