import { Eye, EyeOff, Send } from "lucide-react";
import type { ChatSendRequest, PlayerLobbyView, PublicGameState } from "@werewolf/shared";
import { type FormEvent, useEffect, useState } from "react";
import { RoleArtwork } from "../game/RoleArtwork";
import { Brand, PhaseClockDisplay } from "../shared/AppChrome";
import { ChatTimeline } from "../shared/ChatTimeline";
import { PublicPlayerRoster } from "../shared/PublicPlayerRoster";
import { HunterActionPanel } from "./NightActionPanels";

export function ChatModeStatus({ chatMode }: Pick<PlayerLobbyView, "chatMode">) {
  return (
    <div className={`player-chat-mode mode-${chatMode}`} role="status">
      <span>{chatMode === "open" ? "自由讨论" : "有序发言"}</span>
      <small>{chatMode === "open" ? "可同时参与公开文字讨论" : "按发言顺序参与公开文字发言"}</small>
    </div>
  );
}

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`connection-pill ${connected ? "status-connected" : "status-disconnected"}`}>
      <span />
      {connected ? "已连接" : "连接中断"}
    </span>
  );
}

export function DayFlowScreen({
  lobby,
  game,
  connected,
  onFinishSpeaking,
  onSendChat,
  onSelectVote,
  onConfirmVote,
  onHunterShoot
}: {
  lobby: PlayerLobbyView;
  game: PublicGameState | null;
  connected: boolean;
  onFinishSpeaking: () => void;
  onSendChat: (payload: ChatSendRequest) => void;
  onSelectVote: (target: string | "abstain" | null) => void;
  onConfirmVote: (confirmed: boolean) => void;
  onHunterShoot: (target: string | null) => void;
}) {
  const day = lobby.dayState;
  const self = lobby.players.find((player) => player.id === lobby.selfId);
  const isCurrentSpeaker = day?.currentSpeaker?.id === lobby.selfId;
  const alive = day?.alivePlayerIds.includes(lobby.selfId) ?? false;
  const revealedIdiot = lobby.revealedIdiotId
    ? lobby.players.find((player) => player.id === lobby.revealedIdiotId)
    : null;
  const hunterAction = lobby.hunterAction;
  const hunterActionActive = hunterAction?.active ?? false;
  const [roleVisible, setRoleVisible] = useState(false);
  const [message, setMessage] = useState("");
  const paused = game?.clock.status === "paused";

  useEffect(() => {
    setRoleVisible(false);
  }, [lobby.phase]);

  function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || !lobby.publicChat.canSend || paused) return;
    onSendChat({ channel: "day-public", content: { kind: "text", text } });
    setMessage("");
  }

  return (
    <main className="player-shell day-shell">
      <header className="player-header"><Brand /><ConnectionBadge connected={connected} /></header>
      <section className="mobile-state day-flow">
        {game && lobby.phase !== "exile-result" ? <div className="day-clock"><PhaseClockDisplay clock={game.clock} /></div> : null}
        <ChatModeStatus chatMode={lobby.chatMode} />
        <div className={`day-role-card ${roleVisible ? "is-revealed" : ""}`}>
          <div className="day-role-card-inner">
            <div className="day-role-card-face day-role-card-back">
              <img src="/assets/roles/card-back.png" alt="身份牌背面" />
            </div>
            <div className="day-role-card-face day-role-card-front">
              {lobby.privateRole ? <RoleArtwork role={lobby.privateRole.role} hidden={!roleVisible} /> : null}
            </div>
          </div>
        </div>
        <button
          className="day-role-toggle"
          type="button"
          disabled={!lobby.privateRole}
          aria-pressed={roleVisible}
          onClick={() => setRoleVisible((visible) => !visible)}
        >
          {roleVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          {roleVisible ? "收起身份" : "查看身份"}
        </button>
        <p className="eyebrow">{hunterActionActive ? "猎人技能" : lobby.phase === "dawn" ? "天亮公布" : lobby.phase === "last-words" ? "第一夜遗言" : lobby.phase === "day-speech" ? "白天发言" : lobby.phase === "day-vote" ? "放逐投票" : "投票结果"}</p>
        <h1>{hunterActionActive
          ? "选择是否开枪"
          : lobby.phase === "dawn"
          ? lobby.dawnResult?.deaths.length
            ? lobby.dawnResult.deaths.map((player) => `${player.number} 号 · ${player.nickname}`).join("、")
            : "昨夜平安"
          : lobby.phase === "exile-result"
          ? day?.voteResult?.exiledPlayer ? `${day.voteResult.exiledPlayer.number} 号被放逐` : "平票，无人放逐"
          : day?.currentSpeaker ? `${day.currentSpeaker.number} 号 · ${day.currentSpeaker.nickname}` : "等待流程推进"}</h1>
        {lobby.phase === "dawn" ? <p>{lobby.dawnResult?.deaths.length ? "以上玩家昨夜死亡" : "昨夜没有玩家死亡"}</p> : null}
        {revealedIdiot ? (
          <div className="idiot-reveal-notice" role="status">
            <strong>{revealedIdiot.number} 号 · {revealedIdiot.nickname} 是白痴</strong>
            <span>身份已公开，本局不再拥有投票权。</span>
          </div>
        ) : null}
        {hunterAction && (hunterActionActive || hunterAction.submitted) ? (
          <HunterActionPanel
            action={hunterAction}
            connected={connected}
            paused={game?.clock.status === "paused"}
            onSubmit={onHunterShoot}
          />
        ) : null}
        {lobby.phase === "last-words" || lobby.phase === "day-speech" ? (
          <>
            <p>{lobby.chatMode === "open"
              ? "自由讨论进行中，所有可发言玩家都能参与公开文字讨论。"
              : isCurrentSpeaker ? "现在轮到你发言。" : "请听当前玩家现场发言。"}</p>
            <div className="speech-order">
              {day?.speechOrder.map((player) => (
                <span className={player.id === day.currentSpeaker?.id ? "is-current" : ""} key={player.id}>
                  {player.number} · {player.nickname}
                </span>
              ))}
            </div>
            <section className="day-chat" aria-label="白天公开聊天">
              <header>
                <strong>公开发言记录</strong>
                <small>{lobby.chatMode === "open"
                  ? "自由讨论"
                  : isCurrentSpeaker ? "轮到你发言" : `等待 ${day?.currentSpeaker?.number ?? ""} 号发言`}</small>
              </header>
              <ChatTimeline messages={lobby.publicChat.messages} emptyText="本局还没有公开文字发言。" />
              {lobby.publicChat.canSend ? (
                <form className="day-chat-form" onSubmit={submitChat}>
                  <textarea
                    value={message}
                    maxLength={200}
                    rows={3}
                    disabled={!connected || paused}
                    aria-label="公开发言内容"
                    placeholder="输入你的公开发言"
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <button type="submit" disabled={!connected || paused || !message.trim()} title="发送公开发言">
                    <Send size={18} aria-hidden="true" />
                    <span>发送</span>
                  </button>
                </form>
              ) : null}
            </section>
            {isCurrentSpeaker ? <button className="confirm-role-button" type="button" disabled={!connected} onClick={onFinishSpeaking}>结束我的发言</button> : null}
          </>
        ) : null}
        {!["last-words", "day-speech"].includes(lobby.phase) && lobby.publicChat.messages.length > 0 ? (
          <section className="day-chat day-chat-readonly" aria-label="白天公开聊天记录">
            <header><strong>公开发言记录</strong><small>只读</small></header>
            <ChatTimeline messages={lobby.publicChat.messages} emptyText="本局还没有公开文字发言。" />
          </section>
        ) : null}
        {lobby.phase === "day-vote" ? alive && lobby.dayVote?.eligible ? (
          <div className="day-vote-panel">
            <p>投票期间其他玩家看不到你的选择，且不能投给自己。</p>
            <div className="day-vote-options">
              {lobby.dayVote.candidates.map((candidate) => (
                <button className={lobby.dayVote?.target === candidate.id ? "is-selected" : ""} type="button" key={candidate.id} disabled={lobby.dayVote?.confirmed} onClick={() => onSelectVote(candidate.id)}>
                  <span>{candidate.number}</span>{candidate.nickname}
                </button>
              ))}
              <button className={lobby.dayVote.target === "abstain" ? "is-selected" : ""} type="button" disabled={lobby.dayVote.confirmed} onClick={() => onSelectVote("abstain")}>弃票</button>
            </div>
            <button className="confirm-role-button" type="button" disabled={!connected || lobby.dayVote.target === null} onClick={() => onConfirmVote(!lobby.dayVote?.confirmed)}>
              {lobby.dayVote.confirmed ? "取消确认并修改" : "确认投票"}
            </button>
            <small className="confirmation-count">已确认 {day?.voteProgress?.confirmed ?? 0} / {day?.voteProgress?.total ?? 0}</small>
          </div>
        ) : (
          <div className="day-ineligible-notice">
            {lobby.revealedIdiotId === lobby.selfId
              ? "你的白痴身份已揭示，本局失去投票权"
              : "你已死亡，等待存活玩家投票"}
          </div>
        ) : null}
        {lobby.phase === "exile-result" && day?.voteResult ? (
          <div className="ballot-result">
            {day.voteResult.ballots.map((ballot) => (
              <div key={ballot.voter.id}><strong>{ballot.voter.number} 号 {ballot.voter.nickname}</strong><span>投给</span><b>{ballot.target ? `${ballot.target.number} 号 ${ballot.target.nickname}` : "弃票"}</b></div>
            ))}
          </div>
        ) : null}
        <PublicPlayerRoster players={lobby.players} selfId={lobby.selfId} phase={lobby.phase} />
        <p className="day-self-state">{self ? `${self.number} 号 · ${self.nickname}` : "玩家"} · {alive ? "存活" : "死亡"}</p>
      </section>
    </main>
  );
}
