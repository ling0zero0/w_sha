import type { LobbyPlayer, PlayerId, RoomPhase } from "@werewolf/shared";
import { BotBadge } from "./BotBadge";

function playerStatus(player: LobbyPlayer, selfId: PlayerId, phase: RoomPhase): string {
  if (!player.alive) return "死亡";
  if (player.controller === "bot") return "自动控制";
  if (player.id === selfId) return "你";
  if (phase !== "lobby") return "存活";
  if (player.connection === "online") return "在线";
  if (player.connection === "reconnecting") return "重连中";
  if (player.connection === "departed") return "已离场";
  return "离线";
}

export function PublicPlayerRoster({
  players,
  selfId,
  phase
}: {
  players: LobbyPlayer[];
  selfId: PlayerId;
  phase: RoomPhase;
}) {
  return (
    <section className="mobile-roster public-player-roster" aria-label="当前玩家">
      <header><span>当前玩家</span><strong>{players.length}</strong></header>
      {players.map((player) => (
        <div
          className={player.id === selfId ? "is-self" : ""}
          key={player.id}
          data-controller={player.controller}
        >
          <span>{String(player.number).padStart(2, "0")}</span>
          <span className="mobile-player-name">
            <strong>{player.nickname}</strong>
            {player.controller === "bot" ? <BotBadge /> : null}
          </span>
          <small>{playerStatus(player, selfId, phase)}</small>
        </div>
      ))}
    </section>
  );
}
