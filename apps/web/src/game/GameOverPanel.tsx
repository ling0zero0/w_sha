import type { GameResult } from "@werewolf/shared";
import { RoleArtwork } from "./RoleArtwork";
import { outcomeLabels, roleLabels } from "./role-meta";

export function GameOverPanel({
  result,
  hostActions
}: {
  result: NonNullable<GameResult>;
  hostActions?: { playAgain: () => void; returnToLobby: () => void };
}) {
  return (
    <section className="game-over-panel">
      <p className="eyebrow">对局结束</p>
      <h2>{outcomeLabels[result.outcome]}</h2>
      <div className="revealed-roles">
        {result.revealedPlayers.map((player) => (
          <article key={player.id}>
            <RoleArtwork role={player.role} className="revealed-role-artwork" alt="" />
            <span>{player.number} 号 · {player.nickname}</span>
            <strong>{roleLabels[player.role]}</strong>
            <small>{player.alive ? "存活" : "死亡"}</small>
          </article>
        ))}
      </div>
      <div className="game-records">
        <h3>对局记录</h3>
        {result.records.length > 0 ? result.records.map((record, index) => (
          <p key={`${record.day}-${record.type}-${index}`}><strong>第 {record.day} 天</strong>{record.detail}</p>
        )) : <p>本局暂无行动记录</p>}
      </div>
      {hostActions ? <div className="game-over-actions"><button type="button" onClick={hostActions.playAgain}>再来一局</button><button type="button" onClick={hostActions.returnToLobby}>返回大厅调整</button></div> : null}
    </section>
  );
}
