import { expect, test, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

const screenshotDirectory = path.resolve("docs/screenshots");
const nicknames = ["林野", "阿岚", "青禾"];

async function getLocalJoinUrl(page: Page): Promise<string> {
  const joinUrl = await page.evaluate(async () => {
    const response = await fetch("/api/host-bootstrap");
    const payload = await response.json() as { lobby: { joinUrl: string } };
    return payload.lobby.joinUrl;
  });
  const invitation = new URL(joinUrl);
  return `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
}

async function joinPlayers(browser: Browser, joinUrl: string): Promise<{
  contexts: BrowserContext[];
  players: Page[];
}> {
  const contexts = await Promise.all(nicknames.map(() => browser.newContext({ ...devices["Pixel 7"] })));
  const players = await Promise.all(contexts.map((context) => context.newPage()));

  for (const [index, player] of players.entries()) {
    await player.goto(joinUrl);
    await player.getByLabel("昵称").fill(nicknames[index]!);
    await player.getByRole("button", { name: "进入大厅" }).click();
    await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
  }

  return { contexts, players };
}

async function setRoleConfiguration(host: Page): Promise<void> {
  await host.getByLabel("狼人数量").fill("1");
  await host.getByLabel("村民数量").fill("1");
  await host.getByLabel("预言家数量").fill("1");
  await host.getByLabel("女巫数量").fill("0");
  await expect(host.getByTestId("start-readiness")).toHaveText("配置就绪");
}

test("generate README screenshots from a complete game", async ({ browser, page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();

  const joinUrl = await getLocalJoinUrl(page);
  const { contexts, players } = await joinPlayers(browser, joinUrl);

  try {
    await setRoleConfiguration(page);
    await expect(page.getByTestId("host-player")).toHaveCount(3);
    await page.screenshot({
      path: path.join(screenshotDirectory, "host-lobby.jpg"),
      type: "jpeg",
      quality: 90
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "开始游戏" }).click();
    await expect(page.getByRole("heading", { name: "玩家确认身份" })).toBeVisible();

    const roles = await Promise.all(players.map((player) => player.getByTestId("private-role").textContent()));
    const wolf = players[roles.indexOf("狼人")]!;
    const seer = players[roles.indexOf("预言家")]!;
    const villager = players[roles.indexOf("村民")]!;
    const wolfNickname = nicknames[roles.indexOf("狼人")]!;
    const playerByNickname = new Map(nicknames.map((nickname, index) => [nickname, players[index]!]));

    await wolf.screenshot({
      path: path.join(screenshotDirectory, "player-role.jpg"),
      type: "jpeg",
      quality: 90
    });

    for (const player of players) {
      await player.getByRole("button", { name: "我已记住身份" }).click();
    }

    await expect(wolf.getByRole("heading", { name: "选择今晚的目标" })).toBeVisible();
    await wolf.getByRole("button", { name: "空刀", exact: true }).click();
    await wolf.getByRole("button", { name: "确认本次选择" }).click();
    await expect(seer.getByRole("heading", { name: "选择一名玩家查验" })).toBeVisible();
    await seer.getByRole("button", { name: new RegExp(wolfNickname) }).click();

    await expect(page.getByRole("heading", { name: "天亮了" })).toBeVisible();
    await page.getByRole("button", { name: "进入白天流程" }).click();

    for (let index = 0; index < players.length; index += 1) {
      const currentHeading = page.locator(".host-day-panel h2");
      const currentText = await currentHeading.textContent();
      const nickname = nicknames.find((name) => currentText?.includes(name));
      if (!nickname) throw new Error("无法识别当前发言玩家");
      await playerByNickname.get(nickname)!.getByRole("button", { name: "结束我的发言" }).click();
      if (index < players.length - 1) await expect(currentHeading).not.toHaveText(currentText ?? "");
    }

    await expect(page.getByRole("heading", { name: "放逐投票" })).toBeVisible();
    await villager.getByRole("button", { name: new RegExp(wolfNickname) }).click();
    await villager.evaluate(() => window.scrollTo(0, 0));
    await villager.screenshot({
      path: path.join(screenshotDirectory, "player-vote.jpg"),
      type: "jpeg",
      quality: 90
    });

    for (const [index, player] of players.entries()) {
      if (player === villager) {
        await player.getByRole("button", { name: "确认投票" }).click();
      } else {
        await player.getByRole("button", {
          name: roles[index] === "狼人" ? "弃票" : new RegExp(wolfNickname)
        }).click();
        await player.getByRole("button", { name: "确认投票" }).click();
      }
    }

    await expect(page.getByRole("heading", { name: "好人胜利" })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(screenshotDirectory, "game-result.jpg"),
      type: "jpeg",
      quality: 90
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
