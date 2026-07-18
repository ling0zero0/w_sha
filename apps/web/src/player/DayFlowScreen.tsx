import { Eye, EyeOff } from "lucide-react";
import type { PlayerLobbyView, PublicGameState } from "@werewolf/shared";
import { useEffect, useState } from "react";
import { roleImages, roleLabels } from "../game/role-meta";
import { Brand, PhaseClockDisplay } from "../shared/AppChrome";

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
  onSelectVote,
  onConfirmVote
}: {
  lobby: PlayerLobbyView;
  game: PublicGameState | null;
  connected: boolean;
  onFinishSpeaking: () => void;
  onSelectVote: (target: string | "abstain" | null) => void;
  onConfirmVote: (confirmed: boolean) => void;
}) {
  const day = lobby.dayState;
  const self = lobby.players.find((player) => player.id === lobby.selfId);
  const isCurrentSpeaker = day?.currentSpeaker?.id === lobby.selfId;
  const alive = day?.alivePlayerIds.includes(lobby.selfId) ?? false;
  const [roleVisible, setRoleVisible] = useState(false);

  useEffect(() => {
    setRoleVisible(false);
  }, [lobby.phase]);

  return (
    <main className="player-shell day-shell">
      <header className="player-header"><Brand /><ConnectionBadge connected={connected} /></header>
      <section className="mobile-state day-flow">
        {game && lobby.phase !== "exile-result" ? <div className="day-clock"><PhaseClockDisplay clock={game.clock} /></div> : null}
        <div className={`day-role-card ${roleVisible ? "is-revealed" : ""}`}>
          <div className="day-role-card-inner">
            <div className="day-role-card-face day-role-card-back">
              <img src="/assets/roles/card-back.png" alt="身份牌背面" />
            </div>
            <div className="day-role-card-face day-role-card-front">
              {roleVisible && lobby.privateRole ? <img src={roleImages[lobby.privateRole.role]} alt={`${roleLabels[lobby.privateRole.role]}身份牌`} /> : null}
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
        <p className="eyebrow">{lobby.phase === "dawn" ? "天亮公布" : lobby.phase === "last-words" ? "第一夜遗言" : lobby.phase === "day-speech" ? "白天发言" : lobby.phase === "day-vote" ? "放逐投票" : "投票结果"}</p>
        <h1>{lobby.phase === "dawn"
          ? lobby.dawnResult?.deaths.length
            ? lobby.dawnResult.deaths.map((player) => `${player.number} 号 · ${player.nickname}`).join("、")
            : "昨夜平安"
          : lobby.phase === "exile-result"
          ? day?.voteResult?.exiledPlayer ? `${day.voteResult.exiledPlayer.number} 号被放逐` : "平票，无人放逐"
          : day?.currentSpeaker ? `${day.currentSpeaker.number} 号 · ${day.currentSpeaker.nickname}` : "等待流程推进"}</h1>
        {lobby.phase === "dawn" ? <p>{lobby.dawnResult?.deaths.length ? "以上玩家昨夜死亡" : "昨夜没有玩家死亡"}</p> : null}
        {lobby.phase === "last-words" || lobby.phase === "day-speech" ? (
          <>
            <p>{isCurrentSpeaker ? "现在轮到你发言。" : "请听当前玩家现场发言。"}</p>
            <div className="speech-order">
              {day?.speechOrder.map((player) => (
                <span className={player.id === day.currentSpeaker?.id ? "is-current" : ""} key={player.id}>
                  {player.number} · {player.nickname}
                </span>
              ))}
            </div>
            {isCurrentSpeaker ? <button className="confirm-role-button" type="button" disabled={!connected} onClick={onFinishSpeaking}>结束我的发言</button> : null}
          </>
        ) : null}
        {lobby.phase === "day-vote" ? alive && lobby.dayVote ? (
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
        ) : <div className="role-confirmed">你已死亡，等待存活玩家投票</div> : null}
        {lobby.phase === "exile-result" && day?.voteResult ? (
          <div className="ballot-result">
            {day.voteResult.ballots.map((ballot) => (
              <div key={ballot.voter.id}><strong>{ballot.voter.number} 号 {ballot.voter.nickname}</strong><span>投给</span><b>{ballot.target ? `${ballot.target.number} 号 ${ballot.target.nickname}` : "弃票"}</b></div>
            ))}
          </div>
        ) : null}
        <p className="day-self-state">{self ? `${self.number} 号 · ${self.nickname}` : "玩家"} · {alive ? "存活" : "死亡"}</p>
      </section>
    </main>
  );
}
