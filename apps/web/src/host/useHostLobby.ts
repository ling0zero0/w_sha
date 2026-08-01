import {
  hostBootstrapSchema,
  type ChatMode,
  type ChatMessage,
  type ClientToServerEvents,
  type HostAddBotRequest,
  type HostLobbyView,
  type PlayerId,
  type PublicGameState,
  type RoleConfiguration,
  type RoomActionResult,
  type ServerToClientEvents
} from "@werewolf/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { createActionId } from "../socket/action-id";

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

function lastSequence(messages: ChatMessage[]): number {
  return messages.reduce((latest, message) => Math.max(latest, message.sequence), 0);
}

export function useHostLobby() {
  const [state, setState] = useState(initialState);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const chatSessionRef = useRef<string | null>(null);
  const chatCursorRef = useRef(0);
  const replayLoadedRef = useRef(false);

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

        const resetChatHistory = () => {
          chatSessionRef.current = null;
          chatCursorRef.current = 0;
          replayLoadedRef.current = false;
        };

        const mergeHistory = (messages: ChatMessage[], clearExisting: boolean) => {
          const publicMessages = messages.filter(
            (message) => message.channel === "day-public" || message.channel === "system"
          );
          setState((current) => current.lobby ? {
            ...current,
            lobby: {
              ...current.lobby,
              publicChat: {
                ...current.lobby.publicChat,
                messages: mergeMessages(
                  clearExisting ? [] : current.lobby.publicChat.messages,
                  publicMessages
                )
              }
            }
          } : current);
        };

        const requestHistory = (view: HostLobbyView, fromStart = false) => {
          if (view.phase === "lobby" || (fromStart && replayLoadedRef.current)) return;
          const initialAfterSequence = fromStart
            ? 0
            : Math.max(chatCursorRef.current, lastSequence(view.publicChat.messages));

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

        const applyLobbyView = (lobby: HostLobbyView) => {
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
                    }
                  },
              error: ""
            };
          });
          requestHistory(lobby, lobby.phase === "game-over");
        };

        socket.on("connect", () => {
          setState((current) => ({ ...current, socket: "connected" }));
          requestHistory(bootstrap.lobby, bootstrap.lobby.phase === "game-over");
        });
        socket.on("connect_error", () => setState((current) => ({ ...current, socket: "disconnected" })));
        socket.on("disconnect", () => setState((current) => ({ ...current, socket: "disconnected" })));
        socket.on("host:state", applyLobbyView);
        socket.on("game:public-state", (game) => setState((current) => ({ ...current, game })));
        socket.on("chat:message", (message) => {
          chatCursorRef.current = Math.max(chatCursorRef.current, message.sequence);
          setState((current) => ({
            ...current,
            lobby: current.lobby && (message.channel === "day-public" || message.channel === "system")
              ? {
                  ...current.lobby,
                  publicChat: {
                    ...current.lobby.publicChat,
                    messages: appendMessage(current.lobby.publicChat.messages, message)
                  }
                }
              : current.lobby
          }));
        });
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
                }
              },
          error: ""
        };
      });
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
    socketRef.current?.emit("host:refresh-join", { actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const movePlayer = useCallback((playerId: PlayerId, direction: "up" | "down") => {
    socketRef.current?.emit("host:move-player", { playerId, direction, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const removePlayer = useCallback((playerId: PlayerId) => {
    socketRef.current?.emit("host:remove-player", { playerId, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const addBot = useCallback((request: HostAddBotRequest) => {
    socketRef.current?.emit("host:add-bot", { ...request, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const correctPlayerLife = useCallback((playerId: PlayerId, alive: boolean) => {
    socketRef.current?.emit("host:correct-player-life", { playerId, alive, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const resolveTakeover = useCallback((requestId: string, approved: boolean) => {
    socketRef.current?.emit("host:resolve-takeover", { requestId, approved, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const pausePhase = useCallback(() => {
    socketRef.current?.emit("host:pause-phase", { actionId: createActionId() }, applyGameResult);
  }, [applyGameResult]);

  const resumePhase = useCallback(() => {
    socketRef.current?.emit("host:resume-phase", { actionId: createActionId() }, applyGameResult);
  }, [applyGameResult]);

  const adjustPhaseTime = useCallback((deltaMs: number) => {
    socketRef.current?.emit("host:adjust-phase-time", { deltaMs, actionId: createActionId() }, applyGameResult);
  }, [applyGameResult]);

  const forceEndPhase = useCallback(() => {
    socketRef.current?.emit("host:force-end-phase", { actionId: createActionId() }, applyGameResult);
  }, [applyGameResult]);

  const skipNightPhase = useCallback(() => {
    socketRef.current?.emit("host:skip-night-phase", { actionId: createActionId() }, applyGameResult);
  }, [applyGameResult]);

  const updateRoleConfiguration = useCallback((configuration: RoleConfiguration) => {
    socketRef.current?.emit("host:update-role-configuration", { ...configuration, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const updateChatMode = useCallback((chatMode: ChatMode) => {
    socketRef.current?.emit("host:update-chat-mode", { chatMode, actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const startGame = useCallback(() => {
    socketRef.current?.emit("host:start-game", { actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const continueFromDawn = useCallback(() => {
    socketRef.current?.emit("host:continue-from-dawn", { actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const continueFromExile = useCallback(() => {
    socketRef.current?.emit("host:continue-from-exile", { actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const skipDayPhase = useCallback(() => {
    socketRef.current?.emit("host:skip-day-phase", { actionId: createActionId() }, applyGameResult);
  }, [applyGameResult]);

  const playAgain = useCallback(() => {
    socketRef.current?.emit("host:play-again", { actionId: createActionId() }, applyResult);
  }, [applyResult]);

  const returnToLobby = useCallback(() => {
    socketRef.current?.emit("host:return-to-lobby", { actionId: createActionId() }, applyResult);
  }, [applyResult]);

  return {
    ...state,
    refreshJoin,
    movePlayer,
    removePlayer,
    addBot,
    correctPlayerLife,
    resolveTakeover,
    pausePhase,
    resumePhase,
    adjustPhaseTime,
    forceEndPhase,
    skipNightPhase,
    updateRoleConfiguration,
    updateChatMode,
    startGame,
    continueFromDawn,
    continueFromExile,
    skipDayPhase,
    playAgain,
    returnToLobby
  };
}
