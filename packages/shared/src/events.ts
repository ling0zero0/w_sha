import type {
  ActionPayload,
  ActionRequest,
  DayConfirmVoteRequest,
  DaySelectVoteRequest,
  ChatSendRequest,
  GuardProtectRequest,
  HostAdjustPhaseTimeRequest,
  HostCorrectPlayerLifeRequest,
  HostMovePlayerRequest,
  HostPlayerRequest,
  HostResolveTakeoverRequest,
  HunterShootRequest,
  RoomActionAck,
  SeerInspectRequest,
  WitchSubmitActionRequest,
  WolfConfirmVoteRequest,
  WolfSelectTargetRequest,
  WolfSendMessageRequest
} from "./actions.js";
import type {
  ChatHistoryPage,
  ChatHistoryRequest,
  ChatMessage
} from "./chat.js";
import type { HostAddBotRequest } from "./bot.js";
import type { RoleConfigurationInput } from "./domain.js";
import type { PublicGameState } from "./game.js";
import type {
  HostLobbyView,
  HostUpdateChatModeRequest,
  JoinLobbyRequest,
  PlayerLobbyView,
  PlayerSession,
  ReconnectPlayerRequest,
  TakeoverPlayerRequest,
  TakeoverReceipt
} from "./lobby.js";
import type { ClientPing, ServerPong, ServiceStatus } from "./system.js";

type OptionalActionEvent<T> = (
  payloadOrAck?: ActionRequest | RoomActionAck<T>,
  ack?: RoomActionAck<T>
) => void;

export interface ClientToServerEvents {
  "system:ping": (payload: ClientPing) => void;
  "player:join": (payload: ActionPayload<JoinLobbyRequest>, ack: RoomActionAck<PlayerSession>) => void;
  "player:reconnect": (payload: ActionPayload<ReconnectPlayerRequest>, ack: RoomActionAck<PlayerSession>) => void;
  "player:request-takeover": (payload: ActionPayload<TakeoverPlayerRequest>, ack: RoomActionAck<TakeoverReceipt>) => void;
  "host:refresh-join": OptionalActionEvent<HostLobbyView>;
  "host:add-bot": (payload: ActionPayload<HostAddBotRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:move-player": (payload: ActionPayload<HostMovePlayerRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:remove-player": (payload: ActionPayload<HostPlayerRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:depart-player": (payload: ActionPayload<HostPlayerRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:correct-player-life": (payload: ActionPayload<HostCorrectPlayerLifeRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:resolve-takeover": (payload: ActionPayload<HostResolveTakeoverRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:update-role-configuration": (payload: ActionPayload<RoleConfigurationInput>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:update-chat-mode": (payload: ActionPayload<HostUpdateChatModeRequest>, ack: RoomActionAck<HostLobbyView>) => void;
  "host:start-game": OptionalActionEvent<HostLobbyView>;
  "player:confirm-role": OptionalActionEvent<PlayerLobbyView>;
  "wolf:select-target": (payload: ActionPayload<WolfSelectTargetRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "wolf:confirm-vote": (payload: ActionPayload<WolfConfirmVoteRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "wolf:send-message": (payload: ActionPayload<WolfSendMessageRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "chat:send": (payload: ActionPayload<ChatSendRequest>, ack: RoomActionAck<ChatMessage>) => void;
  "chat:history": (payload: ChatHistoryRequest, ack: RoomActionAck<ChatHistoryPage>) => void;
  "seer:inspect": (payload: ActionPayload<SeerInspectRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "witch:submit-action": (payload: ActionPayload<WitchSubmitActionRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "guard:protect": (payload: ActionPayload<GuardProtectRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "hunter:shoot": (payload: ActionPayload<HunterShootRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "host:continue-from-dawn": OptionalActionEvent<HostLobbyView>;
  "host:continue-from-exile": OptionalActionEvent<HostLobbyView>;
  "host:play-again": OptionalActionEvent<HostLobbyView>;
  "host:return-to-lobby": OptionalActionEvent<HostLobbyView>;
  "player:finish-speaking": OptionalActionEvent<PlayerLobbyView>;
  "day:select-vote": (payload: ActionPayload<DaySelectVoteRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "day:confirm-vote": (payload: ActionPayload<DayConfirmVoteRequest>, ack: RoomActionAck<PlayerLobbyView>) => void;
  "host:pause-phase": OptionalActionEvent<PublicGameState>;
  "host:resume-phase": OptionalActionEvent<PublicGameState>;
  "host:adjust-phase-time": (payload: ActionPayload<HostAdjustPhaseTimeRequest>, ack: RoomActionAck<PublicGameState>) => void;
  "host:force-end-phase": OptionalActionEvent<PublicGameState>;
  "host:skip-night-phase": OptionalActionEvent<PublicGameState>;
  "host:skip-day-phase": OptionalActionEvent<PublicGameState>;
}

export interface ServerToClientEvents {
  "system:ready": (payload: ServiceStatus) => void;
  "system:pong": (payload: ServerPong) => void;
  "host:state": (payload: HostLobbyView) => void;
  "player:state": (payload: PlayerLobbyView) => void;
  "game:public-state": (payload: PublicGameState) => void;
  "chat:message": (payload: ChatMessage) => void;
  "player:removed": (payload: { message: string }) => void;
  "player:departed": (payload: { message: string }) => void;
  "player:session-replaced": (payload: { message: string }) => void;
  "player:takeover-approved": (payload: PlayerSession) => void;
  "player:takeover-rejected": (payload: { message: string }) => void;
}
