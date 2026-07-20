import type {
  AiBotProfileView,
  HostAddBotRequest,
  LobbyPlayer
} from "@werewolf/shared";
import { Bot, ExternalLink, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { createAiAdminClient } from "../ai/ai-client";

export function nextBotNickname(players: Pick<LobbyPlayer, "nickname">[]): string {
  const nicknames = new Set(players.map((player) => player.nickname));
  let index = 1;
  while (nicknames.has(`机器人 ${index}`)) index += 1;
  return `机器人 ${index}`;
}

type BotChoice = "deterministic" | string;

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
  const [choice, setChoice] = useState<BotChoice>("deterministic");
  const [profiles, setProfiles] = useState<AiBotProfileView[]>([]);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const client = createAiAdminClient();
    void client.getOverview(controller.signal).then((configuration) => {
      const enabledModels = new Set(configuration.models.filter((model) => model.enabled).map((model) => model.id));
      const enabledProviders = new Set(configuration.providers.filter((provider) => provider.enabled).map((provider) => provider.id));
      const usableModels = new Set(configuration.models.filter(
        (model) => model.enabled && enabledProviders.has(model.providerId)
      ).map((model) => model.id));
      setProfiles(configuration.botProfiles.filter(
        (profile) => profile.enabled && enabledModels.has(profile.modelProfileId) && usableModels.has(profile.modelProfileId)
      ));
      setProfileError("");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setProfileError(error instanceof Error ? error.message : "无法加载 AI 机器人档案");
    });
    return () => controller.abort();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname || !connected) return;

    const request: HostAddBotRequest = choice === "deterministic"
      ? { nickname: trimmedNickname, botKind: "deterministic" }
      : { nickname: trimmedNickname, botKind: "llm", botProfileId: choice };
    onAddBot(request);
    setNickname(nextBotNickname([...players, { nickname: trimmedNickname }]));
  }

  function changeChoice(next: string) {
    setChoice(next);
    if (next === "deterministic") return;
    const profile = profiles.find((candidate) => candidate.id === next);
    if (profile) setNickname(profile.defaultNickname);
  }

  return (
    <form className="bot-add-form" onSubmit={submit}>
      <label htmlFor="bot-profile-choice">
        <Bot size={16} aria-hidden="true" />
        机器人类型
      </label>
      <select
        id="bot-profile-choice"
        value={choice}
        disabled={!connected}
        onChange={(event) => changeChoice(event.target.value)}
      >
        <option value="deterministic">确定性机器人（离线可用）</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}</option>
        ))}
      </select>
      <label htmlFor="bot-nickname">机器人昵称</label>
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
      <p className="bot-profile-help">
        {profileError || (profiles.length === 0
          ? "暂无可用 AI 档案；确定性机器人仍可正常使用。"
          : `已加载 ${profiles.length} 个可用 AI 档案。`)}
        {" "}<a href="/ai"><ExternalLink size={13} aria-hidden="true" />管理 AI 档案</a>
      </p>
    </form>
  );
}
