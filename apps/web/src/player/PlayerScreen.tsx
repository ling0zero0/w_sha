import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UsersRound,
  X
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { GameOverPanel } from "../game/GameOverPanel";
import { RoleArtwork } from "../game/RoleArtwork";
import { roleLabels } from "../game/role-meta";
import { getJoinInvitation } from "../routing";
import { Brand, InterventionNotices, PhaseClockDisplay } from "../shared/AppChrome";
import { ConnectionBadge, DayFlowScreen } from "./DayFlowScreen";
import { GuardActionPanel, WitchActionPanel, WolfChatPanel } from "./NightActionPanels";
import { usePlayerLobby } from "./usePlayerLobby";

function InvalidInvitation() {
  return (
    <main className="player-shell">
      <header className="player-header"><Brand /></header>
      <section className="mobile-state mobile-state-centered">
        <span className="large-state-icon"><CircleAlert size={31} aria-hidden="true" /></span>
        <p className="eyebrow">无法加入</p>
        <h1>邀请链接无效</h1>
        <p>请重新扫描主机屏幕上的二维码。</p>
        <a className="secondary-link" href="/">
          <ArrowLeft size={18} aria-hidden="true" />返回
        </a>
      </section>
    </main>
  );
}

export function PlayerScreen() {
  const invitation = getJoinInvitation(window.location);
  if (!invitation) return <InvalidInvitation />;
  return <PlayerLobby invitation={invitation} />;
}

function PlayerLobby({ invitation }: { invitation: NonNullable<ReturnType<typeof getJoinInvitation>> }) {
  const {
    socket,
    lobby,
    game,
    joining,
    restoring,
    canRequestTakeover,
    takeoverPending,
    error,
    removed,
    replaced,
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
  } = usePlayerLobby(invitation);
  const [nickname, setNickname] = useState("");
  const nightPaused = game?.clock.status === "paused";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    join(nickname);
  }

  if (restoring && !lobby) {
    return (
      <main className="player-shell">
        <header className="player-header"><Brand /><ConnectionBadge connected={socket === "connected"} /></header>
        <section className="mobile-state mobile-state-centered">
          <span className="large-state-icon"><RefreshCw className="spin" size={28} aria-hidden="true" /></span>
          <p className="eyebrow">正在恢复会话</p>
          <h1>重新连接原座位</h1>
          <p>正在验证此设备保存的玩家凭证。</p>
        </section>
      </main>
    );
  }

  if (lobby) {
    const self = lobby.players.find((player) => player.id === lobby.selfId);
    if (lobby.phase === "game-over" && lobby.gameResult) {
      return <main className="player-shell day-shell"><header className="player-header"><Brand /><ConnectionBadge connected={socket === "connected"} /></header><section className="mobile-state"><GameOverPanel result={lobby.gameResult} /></section></main>;
    }
    if (["dawn", "last-words", "day-speech", "day-vote", "exile-result"].includes(lobby.phase) || lobby.hunterAction?.active) {
      return <DayFlowScreen
        lobby={lobby}
        game={game}
        connected={socket === "connected"}
        onFinishSpeaking={finishSpeaking}
        onSelectVote={selectDayVote}
        onConfirmVote={confirmDayVote}
        onHunterShoot={shootAsHunter}
      />;
    }
    if (lobby.privateRole) {
      const privateRole = lobby.privateRole;
      if (self && !self.alive && lobby.phase !== "dawn") {
        return (
          <main className="player-shell role-screen dead-observer-screen">
            <header className="player-header"><Brand /><ConnectionBadge connected={socket === "connected"} /></header>
            <section className="mobile-state mobile-state-centered">
              <span className="large-state-icon"><X size={30} aria-hidden="true" /></span>
              <p className="eyebrow">{self.number} 号 · {self.nickname}</p>
              <h1>你已死亡</h1>
              <p>你现在只能查看公开流程，不能聊天、投票或执行角色技能。</p>
              {game ? <div className="private-night-clock"><PhaseClockDisplay clock={game.clock} /></div> : null}
            </section>
          </main>
        );
      }
      return (
        <main className={`player-shell role-screen role-${privateRole.role}`}>
          <header className="player-header"><Brand /><ConnectionBadge connected={socket === "connected"} /></header>
          <section className="mobile-state role-reveal-state">
            {lobby.phase === "first-night" && game ? (
              <div className="private-night-clock"><PhaseClockDisplay clock={game.clock} /></div>
            ) : null}
            <p className="eyebrow">{self ? `${self.number} 号 · ${self.nickname}` : `房间 ${lobby.roomCode}`}</p>
            <RoleArtwork role={privateRole.role} className="role-artwork" />
            <p>你的身份是</p>
            <h1 data-testid="private-role">{roleLabels[privateRole.role]}</h1>
            {privateRole.role === "wolf" ? (
              <div className="wolf-teammates">
                <span>狼人队友</span>
                {privateRole.wolfTeammates.length > 0
                  ? privateRole.wolfTeammates.map((teammate) => <strong key={teammate.id}>{teammate.number} 号 · {teammate.nickname}</strong>)
                  : <strong>你是唯一的狼人</strong>}
              </div>
            ) : (
              <p className="role-guidance">请记住自己的身份，不要向其他玩家展示此屏幕。</p>
            )}
            {lobby.phase === "first-night" ? (
              privateRole.role === "wolf" && lobby.wolfAction ? (
                <div className="wolf-action-panel">
                  <WolfChatPanel action={lobby.wolfAction} paused={nightPaused} onSend={sendWolfMessage} />
                  <h2>选择今晚的目标</h2>
                  <p>可以选择自己、狼人队友或空刀。确认前可随时修改。</p>
                  <div className="night-targets">
                    {lobby.wolfAction.candidates.map((candidate) => (
                      <button
                        className={lobby.wolfAction?.target === candidate.id ? "is-selected" : ""}
                        type="button"
                        key={candidate.id}
                        disabled={lobby.wolfAction?.locked || nightPaused}
                        onClick={() => selectWolfTarget(candidate.id)}
                      >
                        <span>{String(candidate.number).padStart(2, "0")}</span>{candidate.nickname}
                      </button>
                    ))}
                    <button
                      className={lobby.wolfAction.target === "no-kill" ? "is-selected" : ""}
                      type="button"
                      disabled={lobby.wolfAction.locked || nightPaused}
                      onClick={() => selectWolfTarget("no-kill")}
                    >空刀</button>
                  </div>
                  {lobby.wolfAction.locked ? (
                    <div className="role-confirmed"><Check size={18} aria-hidden="true" />狼人行动已锁定</div>
                  ) : (
                    <button
                      className="confirm-role-button"
                      type="button"
                      disabled={lobby.wolfAction.target === null || socket !== "connected" || nightPaused}
                      onClick={() => confirmWolfVote(!lobby.wolfAction?.confirmed)}
                    >
                      {lobby.wolfAction.confirmed ? "取消确认并修改" : "确认本次选择"}
                    </button>
                  )}
                  <small className="confirmation-count">夜间行动进行中</small>
                </div>
              ) : privateRole.role === "seer" && (lobby.seerAction?.active || lobby.seerAction?.result) ? (
                <div className="night-role-panel seer-action-panel">
                  <h2>选择一名玩家查验</h2>
                  <p>查验结果只显示狼人或好人，并且只有你能看到。</p>
                  {lobby.seerAction.result && lobby.seerAction.inspectedPlayer ? (
                    <div className={`inspection-result result-${lobby.seerAction.result}`}>
                      <span>{lobby.seerAction.inspectedPlayer.number} 号 · {lobby.seerAction.inspectedPlayer.nickname}</span>
                      <strong>{lobby.seerAction.result === "wolf" ? "狼人" : "好人"}</strong>
                    </div>
                  ) : (
                    <div className="night-targets">
                      {lobby.seerAction.candidates.map((candidate) => (
                        <button type="button" disabled={nightPaused} key={candidate.id} onClick={() => inspectAsSeer(candidate.id)}>
                          <span>{String(candidate.number).padStart(2, "0")}</span>{candidate.nickname}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : privateRole.role === "witch" && lobby.witchAction?.active ? (
                <WitchActionPanel action={lobby.witchAction} paused={nightPaused} onSubmit={submitWitchAction} />
              ) : privateRole.role === "guard" && (lobby.guardAction?.active || lobby.guardAction?.submitted) ? (
                <GuardActionPanel
                  action={lobby.guardAction}
                  paused={nightPaused}
                  connected={socket === "connected"}
                  onSubmit={protectAsGuard}
                />
              ) : (
                <div className="role-confirmed"><RefreshCw className="slow-spin" size={18} aria-hidden="true" />夜间行动进行中</div>
              )
            ) : lobby.phase === "dawn" ? (
              <div className="dawn-result">
                <p className="eyebrow">天亮公布</p>
                <h2>{lobby.dawnResult?.deaths.length
                  ? lobby.dawnResult.deaths.map((player) => `${player.number} 号 · ${player.nickname}`).join("、")
                  : "昨夜平安夜"}</h2>
                <p>{lobby.dawnResult?.deaths.length ? "以上玩家昨夜死亡，死亡原因不会公开。" : "昨夜没有玩家死亡。"}</p>
              </div>
            ) : privateRole.confirmed ? (
              <div className="role-confirmed"><Check size={18} aria-hidden="true" />已确认，等待其他玩家</div>
            ) : (
              <button className="confirm-role-button" type="button" onClick={confirmRole} disabled={socket !== "connected"}>
                <Check size={19} aria-hidden="true" />我已记住身份
              </button>
            )}
            <small className="confirmation-count">已确认 {lobby.roleConfirmation.confirmed} / {lobby.roleConfirmation.total}</small>
          </section>
        </main>
      );
    }
    return (
      <main className="player-shell">
        <header className="player-header">
          <Brand />
          <ConnectionBadge connected={socket === "connected"} />
        </header>
        <section className="mobile-state waiting-state">
          <div className="waiting-heading">
            <span className="large-state-icon"><UsersRound size={29} aria-hidden="true" /></span>
            <p className="eyebrow">房间 {lobby.roomCode}</p>
            <h1>已进入大厅</h1>
            <p>{self ? `${self.number} 号 · ${self.nickname}` : "玩家席位已确认"}</p>
          </div>

          {game ? (
            <div className="player-phase-panel">
              <PhaseClockDisplay clock={game.clock} />
              <InterventionNotices game={game} />
            </div>
          ) : null}

          <div className="mobile-roster" aria-label="当前玩家">
            <header><span>当前玩家</span><strong>{lobby.players.length}</strong></header>
            {lobby.players.map((player) => (
              <div className={player.id === lobby.selfId ? "is-self" : ""} key={player.id}>
                <span>{String(player.number).padStart(2, "0")}</span>
                <strong>{player.nickname}</strong>
                <small>{
                  player.id === lobby.selfId ? "你"
                    : player.connection === "online" ? "在线"
                      : player.connection === "reconnecting" ? "重连中" : "离线"
                }</small>
              </div>
            ))}
          </div>

          <div className="waiting-footer">
            <RefreshCw className="slow-spin" size={18} aria-hidden="true" />
            等待主机开始游戏
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="player-shell">
      <header className="player-header">
        <Brand />
        <ConnectionBadge connected={socket === "connected"} />
      </header>
      <section className="join-layout">
        <div className="join-intro">
          <p className="eyebrow">房间 {invitation.roomCode}</p>
          <h1>{removed ? "已离开房间" : replaced ? "会话已被接管" : "加入游戏"}</h1>
          <p>{removed ? "主机已移除你的席位。" : replaced ? "此设备已失去该玩家的操作权。" : "输入现场使用的昵称。"}</p>
        </div>

        {removed || replaced ? (
          <a className="secondary-link wide-link" href={window.location.href}>
            <RefreshCw size={18} aria-hidden="true" />重新加入
          </a>
        ) : (
          <form className="join-form" onSubmit={submit}>
            <label htmlFor="nickname">昵称</label>
            <input
              id="nickname"
              name="nickname"
              maxLength={12}
              autoComplete="nickname"
              placeholder="1 至 12 个字符"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              required
            />
            <button type="submit" disabled={joining || socket !== "connected"}>
              <LogIn size={19} aria-hidden="true" />
              {joining ? "正在加入" : "进入大厅"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            {canRequestTakeover || takeoverPending ? (
              <button
                className="takeover-button"
                type="button"
                disabled={takeoverPending || socket !== "connected"}
                onClick={requestTakeover}
              >
                <Smartphone size={19} aria-hidden="true" />
                {takeoverPending ? "等待主机批准" : "申请接管这个昵称"}
              </button>
            ) : null}
          </form>
        )}

        {error ? <p className="form-message" role="alert">{error}</p> : null}
        <div className="player-security">
          <ShieldCheck size={20} aria-hidden="true" />
          <span><strong>身份信息仅在开局后发送</strong><small>当前页面只同步公开大厅信息</small></span>
        </div>
      </section>
    </main>
  );
}
