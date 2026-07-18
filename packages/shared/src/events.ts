import type {
  DayConfirmVoteRequest,
  DaySelectVoteRequest,
  HostAdjustPhaseTimeRequest,
  HostCorrectPlayerLifeRequest,
  HostMovePlayerRequest,
  HostPlayerRequest,
  HostResolveTakeoverRequest,
  RoomActionAck,
  SeerInspectRequest,
  WitchSubmitActionRequest,
  WolfConfirmVoteRequest,
  WolfSelectTargetRequest,
  WolfSendMessageRequest
} from "./actions.js";
import type { RoleConfiguration } from "./domain.js";
import type { PublicGameState } from "./game.js";
import type {
  HostLobbyView,
  JoinLobbyRequest,
  PlayerLobbyView,
  PlayerSession,
  ReconnectPlayerRequest,
  TakeoverPlayerRequest,
  TakeoverReceipt
} from "./lobby.js";
import type { ClientPing, ServerPong, ServiceStatus } from "./system.js";

export interface ClientToServerEvents {
  "system:ping": (payload: ClientPing) => void;
  "player:join": (payload: JoinLobbyRequest, ack: RoomActionAck<PlayerSession>) => void;
  "player:reconnect": (payload: ReconnectPlayerRequest, ack: RoomActionAck<PlayerSession>) => void;
  "player:request-takeover": (payload: TakeoverPlayerRequest, ack: RoomActionAck<TakeoverReceipt>) => void;
  "host:refresh-join": (ack: RoomActionAck<HostLobbyView>) => void;
  "host:move-player": (payload: HostMovePlayerRequest, ack: RoomActionAck<HostLobbyView>) => void;
  "host:remove-player": (payload: HostPlayerRequest, ack: RoomActionAck<HostLobbyView>) => void;
  "host:depart-player": (payload: HostPlayerRequest, ack: RoomActionAck<HostLobbyView>) => void;
  "host:correct-player-life": (payload: HostCorrectPlayerLifeRequest, ack: RoomActionAck<HostLobbyView>) => void;
  "host:resolve-takeover": (payload: HostResolveTakeoverRequest, ack: RoomActionAck<HostLobbyView>) => void;
  "host:update-role-configuration": (payload: RoleConfiguration, ack: RoomActionAck<HostLobbyView>) => void;
  "host:start-game": (ack: RoomActionAck<HostLobbyView>) => void;
  "player:confirm-role": (ack: RoomActionAck<PlayerLobbyView>) => void;
  "wolf:select-target": (payload: WolfSelectTargetRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "wolf:confirm-vote": (payload: WolfConfirmVoteRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "wolf:send-message": (payload: WolfSendMessageRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "seer:inspect": (payload: SeerInspectRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "witch:submit-action": (payload: WitchSubmitActionRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "host:continue-from-dawn": (ack: RoomActionAck<HostLobbyView>) => void;
  "host:continue-from-exile": (ack: RoomActionAck<HostLobbyView>) => void;
  "host:play-again": (ack: RoomActionAck<HostLobbyView>) => void;
  "host:return-to-lobby": (ack: RoomActionAck<HostLobbyView>) => void;
  "player:finish-speaking": (ack: RoomActionAck<PlayerLobbyView>) => void;
  "day:select-vote": (payload: DaySelectVoteRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "day:confirm-vote": (payload: DayConfirmVoteRequest, ack: RoomActionAck<PlayerLobbyView>) => void;
  "host:pause-phase": (ack: RoomActionAck<PublicGameState>) => void;
  "host:resume-phase": (ack: RoomActionAck<PublicGameState>) => void;
  "host:adjust-phase-time": (payload: HostAdjustPhaseTimeRequest, ack: RoomActionAck<PublicGameState>) => void;
  "host:force-end-phase": (ack: RoomActionAck<PublicGameState>) => void;
  "host:skip-night-phase": (ack: RoomActionAck<PublicGameState>) => void;
  "host:skip-day-phase": (ack: RoomActionAck<PublicGameState>) => void;
}

export interface ServerToClientEvents {
  "system:ready": (payload: ServiceStatus) => void;
  "system:pong": (payload: ServerPong) => void;
  "host:state": (payload: HostLobbyView) => void;
  "player:state": (payload: PlayerLobbyView) => void;
  "game:public-state": (payload: PublicGameState) => void;
  "player:removed": (payload: { message: string }) => void;
  "player:departed": (payload: { message: string }) => void;
  "player:session-replaced": (payload: { message: string }) => void;
  "player:takeover-approved": (payload: PlayerSession) => void;
  "player:takeover-rejected": (payload: { message: string }) => void;
}
