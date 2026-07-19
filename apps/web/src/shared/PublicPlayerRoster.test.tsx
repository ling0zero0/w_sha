import type { LobbyPlayer, PlayerId } from "@werewolf/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicPlayerRoster } from "./PublicPlayerRoster";

const humanId = "11111111-1111-4111-8111-111111111111" as PlayerId;

const human = {
  id: humanId,
  number: 1,
  nickname: "Alice",
  connection: "online",
  alive: true,
  controller: "human",
  botKind: null
} satisfies LobbyPlayer;

const bot = {
  id: "22222222-2222-4222-8222-222222222222",
  number: 2,
  nickname: "小灰",
  connection: "reconnecting",
  alive: true,
  controller: "bot",
  botKind: "deterministic"
} satisfies LobbyPlayer;

const otherHuman = {
  id: "33333333-3333-4333-8333-333333333333",
  number: 3,
  nickname: "Bob",
  connection: "offline",
  alive: true,
  controller: "human",
  botKind: null
} satisfies LobbyPlayer;

describe("PublicPlayerRoster", () => {
  it("marks bots without presenting device connection semantics", () => {
    const html = renderToStaticMarkup(
      <PublicPlayerRoster players={[bot]} selfId={humanId} phase="lobby" />
    );

    expect(html).toContain("data-controller=\"bot\"");
    expect(html).toContain("机器人");
    expect(html).toContain("自动控制");
    expect(html).not.toContain("重连中");
    expect(html).not.toContain("在线");
    expect(html).not.toContain("离线");
  });

  it("uses only public player metadata during the game", () => {
    const html = renderToStaticMarkup(
      <PublicPlayerRoster players={[human, bot, otherHuman]} selfId={humanId} phase="day-speech" />
    );

    expect(html).toContain("Alice");
    expect(html).toContain("小灰");
    expect(html).toContain("存活");
    expect(html).not.toContain("村民");
    expect(html).not.toContain("狼人");
  });
});
