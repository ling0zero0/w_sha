import {
  CircleMinus,
  CirclePlus,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  CircleAlert,
  Copy,
  HeartPulse,
  RefreshCw,
  Pause,
  Play,
  ShieldCheck,
  Smartphone,
  Skull,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import { useState } from "react";
import { GameOverPanel } from "../game/GameOverPanel";
import { RoleConfigurationPanel } from "./RoleConfigurationPanel";
import { useHostLobby } from "./useHostLobby";
import { Brand, HostConnectionStatus, InterventionNotices, PhaseClockDisplay } from "../shared/AppChrome";
import { QrCode } from "../shared/QrCode";
import { ChatTimeline } from "../shared/ChatTimeline";
import { BotBadge } from "../shared/BotBadge";
import { HostBotControls } from "./HostBotControls";

export function HostScreen() {
  const {
    api,
    socket,
    lobby,
    game,
    error,
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
  } = useHostLobby();
  const [copied, setCopied] = useState(false);

  async function copyJoinUrl() {
    if (!lobby) return;
    try {
      await navigator.clipboard.writeText(lobby.joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="host-shell">
      <div className="lobby-scene" aria-hidden="true" />
      <header className="topbar">
        <Brand />
        <HostConnectionStatus api={api} socket={socket} />
      </header>

      <section className="lobby-workspace">
        <header className="lobby-heading">
          <div>
            <p className="eyebrow">主机公共屏幕</p>
            <h1>{lobby?.phase === "lobby" ? "等待玩家加入"
              : lobby?.phase === "role-reveal" ? "玩家确认身份"
                : lobby?.phase === "dawn" ? "天亮了"
                  : lobby?.phase === "last-words" ? "第一夜遗言"
                    : lobby?.phase === "day-speech" ? "白天发言"
                      : lobby?.phase === "day-vote" ? "放逐投票"
                        : lobby?.phase === "exile-result" ? "放逐结果"
                          : lobby?.phase === "game-over" ? "对局结束" : "夜间行动进行中"}</h1>
          </div>
          {lobby ? (
            <div className="room-code-block">
              <span>房间号</span>
              <strong data-testid="room-code">{lobby.roomCode}</strong>
            </div>
          ) : null}
        </header>

        {error ? (
          <div className="host-error" role="alert">
            <CircleAlert size={19} aria-hidden="true" />
            {error}
          </div>
        ) : null}

        {game ? (
          <section className="host-phase-panel" aria-label="阶段控制">
            <div className="host-phase-summary">
              <PhaseClockDisplay clock={game.clock} />
              {lobby ? (
                <span className={`chat-mode-status mode-${lobby.chatMode}`}>
                  {lobby.chatMode === "open" ? "自由讨论" : "有序发言"}
                </span>
              ) : null}
            </div>
            <div className="phase-controls">
              <button type="button" onClick={pausePhase} disabled={socket !== "connected" || game.clock.status !== "running"}>
                <Pause size={16} aria-hidden="true" />暂停
              </button>
              <button type="button" onClick={resumePhase} disabled={socket !== "connected" || game.clock.status !== "paused"}>
                <Play size={16} aria-hidden="true" />继续
              </button>
              <button type="button" onClick={() => adjustPhaseTime(-15_000)} disabled={socket !== "connected" || !["running", "paused"].includes(game.clock.status)}>
                <CircleMinus size={16} aria-hidden="true" />15 秒
              </button>
              <button type="button" onClick={() => adjustPhaseTime(15_000)} disabled={socket !== "connected" || !["running", "paused"].includes(game.clock.status)}>
                <CirclePlus size={16} aria-hidden="true" />15 秒
              </button>
              <button
                className="force-end-control"
                type="button"
                onClick={() => window.confirm("确定要终止整局游戏吗？终止后将公开全部身份和对局记录。") && forceEndPhase()}
                disabled={socket !== "connected" || !lobby || ["lobby", "game-over"].includes(lobby.phase)}
              >
                <X size={16} aria-hidden="true" />终止对局
              </button>
              <button
                className="force-end-control"
                type="button"
                onClick={() => window.confirm("确定跳过当前夜间阶段并采用默认结果吗？") && skipNightPhase()}
                disabled={socket !== "connected" || lobby?.phase !== "first-night" || !["running", "paused"].includes(game.clock.status)}
              >
                <ArrowRight size={16} aria-hidden="true" />跳过阶段
              </button>
              <button
                className="force-end-control"
                type="button"
                onClick={() => window.confirm("确定跳过当前白天阶段吗？") && skipDayPhase()}
                disabled={socket !== "connected" || !["last-words", "day-speech", "day-vote"].includes(lobby?.phase ?? "") || !["running", "paused"].includes(game.clock.status)}
              >
                <ArrowRight size={16} aria-hidden="true" />跳过白天阶段
              </button>
            </div>
            <InterventionNotices game={game} />
          </section>
        ) : null}

        {lobby?.phase === "lobby" ? (
          <RoleConfigurationPanel
            configuration={lobby.roleConfiguration}
            chatMode={lobby.chatMode}
            readiness={lobby.startReadiness}
            connected={socket === "connected"}
            onChange={updateRoleConfiguration}
            onChatModeChange={updateChatMode}
            onStart={startGame}
          />
        ) : null}

        {lobby && ["role-reveal", "first-night", "dawn"].includes(lobby.phase) ? (
          <section className="role-confirmation-panel" aria-live="polite">
            <div>
              <p className="eyebrow">身份已私密下发</p>
              <h2>{lobby.dayState?.hunterPending
                ? "等待猎人完成技能"
                : lobby.phase === "dawn"
                ? lobby.dawnResult?.deaths.length
                  ? `昨夜 ${lobby.dawnResult.deaths.map((player) => `${player.number} 号${player.nickname}`).join("、")} 死亡`
                  : "昨夜平安夜"
                : lobby.phase === "first-night" ? "请玩家依次完成夜间行动" : "请玩家在各自手机上确认"}</h2>
            </div>
            <strong data-testid="role-confirmation-progress">
              {lobby.nightProgress
                ? "进行中"
                : `${lobby.roleConfirmation.confirmed} / ${lobby.roleConfirmation.total}`}
            </strong>
            {lobby.nightProgress ? <small>公共屏不会显示当前具体角色阶段</small> : null}
          </section>
        ) : null}

        {lobby?.phase === "dawn" ? (
          <button className="host-continue-button" type="button" onClick={continueFromDawn} disabled={socket !== "connected" || lobby.dayState?.hunterPending}>
            <ArrowRight size={18} aria-hidden="true" />进入白天流程
          </button>
        ) : null}

        {lobby?.phase === "exile-result" ? (
          <button className="host-continue-button" type="button" onClick={continueFromExile} disabled={socket !== "connected" || lobby.dayState?.hunterPending}>
            <ArrowRight size={18} aria-hidden="true" />{lobby.dayState?.voteResult?.exiledPlayer ? "进入放逐遗言" : "进入下一夜"}
          </button>
        ) : null}

        {lobby?.dayState && ["last-words", "day-speech", "day-vote", "exile-result"].includes(lobby.phase) ? (
          <section className="host-day-panel">
            <div>
              <p className="eyebrow">公开白天流程</p>
              <h2>{lobby.dayState.hunterPending
                ? "等待猎人完成技能"
                : lobby.phase === "exile-result"
                ? lobby.dayState.voteResult?.exiledPlayer
                  ? `${lobby.dayState.voteResult.exiledPlayer.number} 号${lobby.dayState.voteResult.exiledPlayer.nickname}被放逐`
                  : "平票，无人放逐"
                : lobby.phase === "day-vote"
                  ? `投票确认 ${lobby.dayState.voteProgress?.confirmed ?? 0} / ${lobby.dayState.voteProgress?.total ?? 0}`
                  : lobby.dayState.currentSpeaker
                    ? `当前：${lobby.dayState.currentSpeaker.number} 号 ${lobby.dayState.currentSpeaker.nickname}`
                    : "等待流程推进"}</h2>
            </div>
            {lobby.phase === "day-vote" ? <p>票型将在全员确认后统一公开</p> : null}
            <section className="host-chat-log" aria-label="公开文字发言">
              <header>
                <strong>公开文字发言</strong>
                <small>{lobby.chatMode === "open" ? "自由讨论" : "有序发言"} · {lobby.publicChat.messages.length} 条</small>
              </header>
              <ChatTimeline messages={lobby.publicChat.messages} emptyText="本局还没有公开文字发言。" />
            </section>
            {lobby.phase === "exile-result" && lobby.dayState.voteResult ? (
              <div className="host-ballots">
                {lobby.dayState.voteResult.ballots.map((ballot) => (
                  <span key={ballot.voter.id}>{ballot.voter.number} 号 → {ballot.target ? `${ballot.target.number} 号` : "弃票"}</span>
                ))}
              </div>
            ) : (
              <div className="host-speech-order">
                {lobby.dayState.speechOrder.map((player) => <span className={player.id === lobby.dayState?.currentSpeaker?.id ? "is-current" : ""} key={player.id}>{player.number} · {player.nickname}</span>)}
              </div>
            )}
          </section>
        ) : null}

        {lobby?.phase === "game-over" && lobby.gameResult ? (
          <GameOverPanel
            result={lobby.gameResult}
            publicMessages={lobby.publicChat.messages}
            hostActions={{ playAgain, returnToLobby }}
          />
        ) : null}

        {lobby ? (
          <div className="lobby-grid">
            {lobby.phase === "lobby" ? <section className="join-station" aria-labelledby="join-title">
              <div className="section-title">
                <span className="section-icon"><Smartphone size={19} aria-hidden="true" /></span>
                <div>
                  <h2 id="join-title">扫码加入</h2>
                  <p>手机连接同一 Wi-Fi 后扫描</p>
                </div>
              </div>

              <div className="qr-frame" data-testid="join-qr">
                <QrCode value={lobby.joinUrl} />
              </div>

              <div className="join-address">
                <span>局域网地址</span>
                <code>{new URL(lobby.joinUrl).host}</code>
              </div>
              <div className="join-tools">
                <button className="icon-command" type="button" onClick={() => void copyJoinUrl()} title="复制加入链接">
                  <Copy size={18} aria-hidden="true" />
                  <span>{copied ? "已复制" : "复制链接"}</span>
                </button>
                <button className="icon-command" type="button" onClick={refreshJoin} title="刷新二维码">
                  <RefreshCw size={18} aria-hidden="true" />
                  <span>刷新二维码</span>
                </button>
              </div>
            </section> : null}

            <section className="roster" aria-labelledby="roster-title">
              <div className="roster-header">
                <div className="section-title">
                  <span className="section-icon"><UsersRound size={19} aria-hidden="true" /></span>
                  <div>
                    <h2 id="roster-title">玩家名册</h2>
                    <p>开局前可调整座位编号</p>
                  </div>
                </div>
                <strong className="player-count" data-testid="player-count">{lobby.players.length}</strong>
              </div>

              {lobby.takeoverRequests.length > 0 ? (
                <div className="takeover-queue" aria-label="设备接管申请">
                  {lobby.takeoverRequests.map((request) => (
                    <div className="takeover-request" key={request.id} data-testid="takeover-request">
                      <span><Smartphone size={17} aria-hidden="true" /></span>
                      <p><strong>{request.nickname}</strong><small>申请在新设备上接管</small></p>
                      <button type="button" className="approve-button" onClick={() => resolveTakeover(request.id, true)} title="批准设备接管">
                        <Check size={17} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => resolveTakeover(request.id, false)} title="拒绝设备接管">
                        <X size={17} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {lobby.phase === "lobby" ? (
                <HostBotControls
                  players={lobby.players}
                  connected={socket === "connected"}
                  onAddBot={addBot}
                />
              ) : null}

              <div className="roster-list">
                {lobby.players.length === 0 ? (
                  <div className="empty-roster">
                    <UsersRound size={29} aria-hidden="true" />
                    <p>暂无玩家</p>
                  </div>
                ) : lobby.players.map((player, index) => (
                  <article className="roster-row" key={player.id} data-testid="host-player">
                    <span className="seat-number">{String(player.number).padStart(2, "0")}</span>
                    <span className="player-name">
                      <span className="player-name-text">{player.nickname}</span>
                      {player.controller === "bot" ? <BotBadge /> : null}
                    </span>
                    <span className={`presence ${player.controller === "bot" ? "presence-bot" : `presence-${player.connection}`}`}>
                      <i />{
                        !player.alive ? "死亡"
                          : player.controller === "bot" ? "自动控制"
                          : player.connection === "online" ? "在线"
                          : player.connection === "reconnecting" ? "重连中"
                            : player.connection === "departed" ? "已离场" : "离线"
                      }
                    </span>
                    <div className="row-actions">
                      <button type="button" onClick={() => movePlayer(player.id, "up")} disabled={lobby.phase !== "lobby" || index === 0} title="上移玩家">
                        <ArrowUp size={17} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => movePlayer(player.id, "down")} disabled={lobby.phase !== "lobby" || index === lobby.players.length - 1} title="下移玩家">
                        <ArrowDown size={17} aria-hidden="true" />
                      </button>
                      <button className="danger-button" type="button" onClick={() => removePlayer(player.id)} disabled={lobby.phase !== "lobby"} title="移除玩家">
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                      {!["lobby", "game-over"].includes(lobby.phase) ? (
                        <button
                          className={player.alive ? "danger-button" : "life-correction-button"}
                          type="button"
                          disabled={player.connection === "departed"}
                          title={player.alive ? "修正为死亡" : "恢复为存活"}
                          onClick={() => window.confirm(
                            `确定将 ${player.number} 号${player.nickname}修正为${player.alive ? "死亡" : "存活"}吗？此操作不会触发遗言或技能。`
                          ) && correctPlayerLife(player.id, !player.alive)}
                        >
                          {player.alive ? <Skull size={17} aria-hidden="true" /> : <HeartPulse size={17} aria-hidden="true" />}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              <footer className="roster-footer">
                {lobby.players.some((player) => player.controller === "bot")
                  ? <Bot size={17} aria-hidden="true" />
                  : <ShieldCheck size={17} aria-hidden="true" />}
                {lobby.phase === "lobby" ? "开局前不会分配或显示任何身份" : "公共屏不会显示任何玩家身份"}
              </footer>
            </section>
          </div>
        ) : (
          <div className="host-loading" role="status">
            <RefreshCw className="spin" size={24} aria-hidden="true" />
            正在创建局域网房间
          </div>
        )}
      </section>

      <footer className="host-footer">
        <span><ShieldCheck size={16} aria-hidden="true" /> 公共屏仅展示公开信息</span>
        <span>阶段 4 · 身份配置与分配</span>
      </footer>
    </main>
  );
}
