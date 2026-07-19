import type { HostAddBotRequest, LobbyPlayer } from "@werewolf/shared";
import { Bot, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";

export function nextBotNickname(players: Pick<LobbyPlayer, "nickname">[]): string {
  const nicknames = new Set(players.map((player) => player.nickname));
  let index = 1;
  while (nicknames.has(`机器人 ${index}`)) index += 1;
  return `机器人 ${index}`;
}

export function HostBotControls({
  players,
  connected,
  onAddBot
}: {
  players: LobbyPlayer[];
  connected: boolean;
  onAddBot: (request: HostAddBotRequest) => void;
}) {
  const [nickname, setNickname] = useState(() => nextBotNickname(players));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname || !connected) return;

    const request: HostAddBotRequest = {
      nickname: trimmedNickname,
      botKind: "deterministic"
    };
    onAddBot(request);
    setNickname(nextBotNickname([
      ...players,
      { nickname: trimmedNickname }
    ]));
  }

  return (
    <form className="bot-add-form" onSubmit={submit}>
      <label htmlFor="bot-nickname">
        <Bot size={16} aria-hidden="true" />
        机器人昵称
      </label>
      <div>
        <input
          id="bot-nickname"
          name="botNickname"
          maxLength={12}
          autoComplete="off"
          value={nickname}
          disabled={!connected}
          onChange={(event) => setNickname(event.target.value)}
        />
        <button type="submit" disabled={!connected || !nickname.trim()}>
          <Plus size={17} aria-hidden="true" />
          添加
        </button>
      </div>
    </form>
  );
}
