import type { RoomActionFailure } from "@werewolf/shared";

export const roomFailures = {
  invalidCredentials: (): RoomActionFailure => ({
    ok: false,
    code: "INVALID_JOIN_CREDENTIALS",
    message: "房间号或加入链接已失效"
  }),
  nicknameTaken: (): RoomActionFailure => ({
    ok: false,
    code: "NICKNAME_TAKEN",
    message: "该昵称已被使用"
  }),
  alreadyJoined: (): RoomActionFailure => ({
    ok: false,
    code: "ALREADY_JOINED",
    message: "此设备已经加入房间"
  }),
  playerNotFound: (): RoomActionFailure => ({
    ok: false,
    code: "PLAYER_NOT_FOUND",
    message: "玩家不存在"
  }),
  invalidReconnectCredentials: (): RoomActionFailure => ({
    ok: false,
    code: "INVALID_RECONNECT_CREDENTIALS",
    message: "重连凭证无效或已经失效"
  }),
  takeoverAlreadyPending: (): RoomActionFailure => ({
    ok: false,
    code: "TAKEOVER_ALREADY_PENDING",
    message: "该玩家已有待处理的设备接管申请"
  }),
  takeoverRequestNotFound: (): RoomActionFailure => ({
    ok: false,
    code: "TAKEOVER_REQUEST_NOT_FOUND",
    message: "设备接管申请不存在或已处理"
  }),
  playerAlreadyDeparted: (): RoomActionFailure => ({
    ok: false,
    code: "PLAYER_ALREADY_DEPARTED",
    message: "玩家已经离场"
  }),
  gameAlreadyStarted: (): RoomActionFailure => ({
    ok: false,
    code: "GAME_ALREADY_STARTED",
    message: "游戏已经开始，无法修改大厅"
  }),
  gameNotReady: (): RoomActionFailure => ({
    ok: false,
    code: "GAME_NOT_READY",
    message: "身份配置或参赛名单尚未满足开局条件"
  }),
  roleAlreadyConfirmed: (): RoomActionFailure => ({
    ok: false,
    code: "ROLE_ALREADY_CONFIRMED",
    message: "身份已经确认"
  }),
  invalidNightAction: (): RoomActionFailure => ({
    ok: false,
    code: "INVALID_NIGHT_ACTION",
    message: "当前身份或阶段不允许此夜间操作"
  }),
  nightActionLocked: (): RoomActionFailure => ({
    ok: false,
    code: "NIGHT_ACTION_LOCKED",
    message: "狼人行动已经锁定"
  }),
  chatRateLimited: (): RoomActionFailure => ({
    ok: false,
    code: "CHAT_RATE_LIMITED",
    message: "消息发送过快，请稍后再试"
  }),
  invalidPhaseControl: (): RoomActionFailure => ({
    ok: false,
    code: "INVALID_PHASE_CONTROL",
    message: "当前阶段状态不允许此操作"
  })
};
