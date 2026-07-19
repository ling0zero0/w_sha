import { expect, test, devices, type Page } from "@playwright/test";

async function getLocalJoinUrl(page: Page): Promise<string> {
  const joinUrl = await page.evaluate(async () => {
    const response = await fetch("/api/host-bootstrap");
    const payload = await response.json() as { lobby: { joinUrl: string } };
    return payload.lobby.joinUrl;
  });
  const invitation = new URL(joinUrl);
  return `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
}

async function joinPlayer(player: Page, joinUrl: string, nickname: string): Promise<void> {
  await player.goto(joinUrl);
  await player.getByLabel("昵称").fill(nickname);
  await player.getByRole("button", { name: "进入大厅" }).click();
  await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
}

test("host and two mobile players complete the LAN lobby workflow", async ({ browser, page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  await expect(page.getByTestId("socket-status")).toContainText("实时已连接");
  await expect(page.getByTestId("room-code")).toHaveText(/^\d{6}$/);
  await expect(page.getByTestId("join-qr").getByRole("img")).toBeVisible();
  await expect(page.getByTestId("phase-clock")).toHaveText("00:00");
  await expect(page.getByRole("button", { name: "暂停" })).toBeDisabled();
  await expect(page.getByTestId("start-readiness")).toHaveText("暂不可开始");
  await expect(page.getByLabel("守卫数量")).toHaveValue("0");
  await expect(page.getByLabel("猎人数量")).toHaveValue("0");
  await expect(page.getByLabel("白痴数量")).toHaveValue("0");

  const joinUrl = await page.evaluate(async () => {
    const response = await fetch("/api/host-bootstrap");
    const payload = await response.json() as { lobby: { joinUrl: string } };
    return payload.lobby.joinUrl;
  });
  const invitation = new URL(joinUrl);
  expect(invitation.protocol).toBe("http:");
  expect(invitation.hostname).toMatch(/^(10\.\d{1,3}|192\.168\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}$/);
  expect(invitation.port).toBe(new URL(page.url()).port);
  expect(invitation.pathname).toMatch(/^\/join\/\d{6}$/);
  await expect(page.getByText(`${invitation.hostname}:${invitation.port}`, { exact: true })).toBeVisible();

  const localJoinUrl = `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
  const mobileOne = await browser.newContext({ ...devices["Pixel 7"] });
  const mobileTwo = await browser.newContext({ ...devices["Pixel 7"] });
  const mobileThree = await browser.newContext({ ...devices["Pixel 7"] });
  const takeoverContext = await browser.newContext({ ...devices["Pixel 7"] });
  const playerOne = await mobileOne.newPage();
  const playerTwo = await mobileTwo.newPage();
  const playerThree = await mobileThree.newPage();
  const takeoverPlayer = await takeoverContext.newPage();

  try {
    await playerOne.goto(localJoinUrl);
    await playerOne.getByLabel("昵称").fill("林野");
    await playerOne.getByRole("button", { name: "进入大厅" }).click();
    await expect(playerOne.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await expect(playerOne.getByTestId("phase-clock")).toHaveText("00:00");
    await expect(page.getByTestId("host-player")).toHaveCount(1);

    const originalSeat = await playerOne.getByText(/1 号 · 林野/).textContent();
    await playerOne.reload();
    await expect(playerOne.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await expect(playerOne.getByText(originalSeat ?? "1 号 · 林野")).toBeVisible();
    await expect(page.getByTestId("host-player")).toHaveCount(1);

    await playerTwo.goto(localJoinUrl);
    await playerTwo.getByLabel("昵称").fill("林野");
    await playerTwo.getByRole("button", { name: "进入大厅" }).click();
    await expect(playerTwo.getByRole("alert")).toHaveText("该昵称已被使用");

    await takeoverPlayer.goto(localJoinUrl);
    await takeoverPlayer.getByLabel("昵称").fill("林野");
    await takeoverPlayer.getByRole("button", { name: "进入大厅" }).click();
    await takeoverPlayer.getByRole("button", { name: "申请接管这个昵称" }).click();
    await expect(page.getByTestId("takeover-request")).toContainText("林野");
    await page.getByTitle("批准设备接管").click();
    await expect(takeoverPlayer.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await expect(takeoverPlayer.getByText(originalSeat ?? "1 号 · 林野")).toBeVisible();
    await expect(playerOne.getByRole("heading", { name: "会话已被接管" })).toBeVisible();
    await expect(page.getByTestId("host-player")).toHaveCount(1);

    await playerTwo.getByLabel("昵称").fill("阿岚");
    await playerTwo.getByRole("button", { name: "进入大厅" }).click();

    await expect(playerTwo.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await expect(page.getByTestId("host-player")).toHaveCount(2);
    await expect(takeoverPlayer.getByLabel("当前玩家").getByText("阿岚")).toBeVisible();
    await expect(playerTwo.getByLabel("当前玩家").getByText("林野")).toBeVisible();

    await page.getByLabel("狼人数量").fill("1");
    await page.getByLabel("村民数量").fill("1");
    await page.getByLabel("预言家数量").fill("0");
    await page.getByLabel("女巫数量").fill("1");
    await expect(page.getByTestId("participant-count")).toHaveText("2");
    await expect(page.getByTestId("configured-role-count")).toHaveText("3");
    await expect(page.getByTestId("start-readiness")).toHaveText("暂不可开始");

    await playerThree.goto(localJoinUrl);
    await playerThree.getByLabel("昵称").fill("青禾");
    await playerThree.getByRole("button", { name: "进入大厅" }).click();
    await expect(playerThree.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await expect(page.getByTestId("participant-count")).toHaveText("3");
    await expect(page.getByTestId("start-readiness")).toHaveText("配置就绪");

    await page.getByLabel("村民数量").fill("0");
    await expect(page.getByRole("list", { name: "开局阻塞原因" })).toContainText("至少需要 1 名村民");
    await page.getByLabel("村民数量").fill("1");
    await page.getByLabel("女巫数量").fill("0");
    await expect(page.getByRole("list", { name: "开局阻塞原因" })).toContainText("至少需要 1 名神职");
    await page.getByLabel("预言家数量").fill("1");
    await expect(page.getByTestId("start-readiness")).toHaveText("配置就绪");
    await expect(takeoverPlayer.locator("body")).not.toContainText("身份配置");

    const secondRow = page.getByTestId("host-player").filter({ hasText: "阿岚" });
    await secondRow.getByTitle("上移玩家").click();
    await expect(page.getByTestId("host-player").first()).toContainText("阿岚");
    await expect(takeoverPlayer.getByLabel("当前玩家").locator("> div").first()).toContainText("阿岚");

    await page.getByTestId("host-player").filter({ hasText: "阿岚" }).getByTitle("移除玩家").click();
    await expect(playerTwo.getByRole("heading", { name: "已离开房间" })).toBeVisible();
    await expect(page.getByTestId("host-player")).toHaveCount(2);

    await page.getByRole("button", { name: "刷新二维码" }).click();
    const staleContext = await browser.newContext({ ...devices["Pixel 7"] });
    const stalePlayer = await staleContext.newPage();
    try {
      await stalePlayer.goto(localJoinUrl);
      await stalePlayer.getByLabel("昵称").fill("旧邀请");
      await stalePlayer.getByRole("button", { name: "进入大厅" }).click();
      await expect(stalePlayer.getByRole("alert")).toHaveText("房间号或加入链接已失效");
    } finally {
      await staleContext.close();
    }

    for (const nickname of ["林野", "青禾"]) {
      const count = await page.getByTestId("host-player").count();
      await page.getByTestId("host-player").filter({ hasText: nickname }).getByTitle("移除玩家").click({ force: true });
      await expect(page.getByTestId("host-player")).toHaveCount(count - 1);
    }
    await expect(page.getByTestId("host-player")).toHaveCount(0);
  } finally {
    await mobileOne.close();
    await mobileTwo.close();
    await mobileThree.close();
    await takeoverContext.close();
  }
});

test("configures a guard and renders its role artwork", async ({ browser, page }) => {
  await page.goto("/");
  const joinUrl = await getLocalJoinUrl(page);
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ ...devices["Pixel 7"] }))
  );
  const players = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    for (const [index, player] of players.entries()) {
      await joinPlayer(player, joinUrl, ["林野", "阿岚", "青禾"][index]!);
    }
    await page.getByLabel("狼人数量").fill("1");
    await page.getByLabel("村民数量").fill("1");
    await page.getByLabel("预言家数量").fill("0");
    await page.getByLabel("女巫数量").fill("0");
    await page.getByLabel("守卫数量").fill("1");
    await page.getByLabel("猎人数量").fill("0");
    await page.getByLabel("白痴数量").fill("0");
    await expect(page.getByTestId("configured-role-count")).toHaveText("3");
    await expect(page.getByTestId("start-readiness")).toHaveText("配置就绪");

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "开始游戏" }).click();
    const roleLabels = await Promise.all(players.map(async (player) => {
      await expect(player.getByText("你的身份是")).toBeVisible();
      return player.locator("h1").textContent();
    }));
    expect([...roleLabels].sort()).toEqual(["守卫", "村民", "狼人"].sort());

    const guard = players[roleLabels.indexOf("守卫")]!;
    await expect(guard.getByRole("img", { name: "守卫身份牌" })).toBeVisible();
    await expect(guard.locator(".role-artwork-frame img")).toHaveAttribute("src", "/assets/roles/guard.png");
    await page.getByRole("button", { name: "终止对局" }).click();
    await expect(page.getByRole("heading", { name: "对局终止" })).toBeVisible();
    await page.getByRole("button", { name: "返回大厅调整" }).click();
    for (const nickname of ["林野", "阿岚", "青禾"]) {
      await page.getByTestId("host-player").filter({ hasText: nickname }).getByTitle("移除玩家").click();
    }
    await expect(page.getByTestId("host-player")).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("host adds deterministic bots that complete a game through the public UI", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();

  const botNickname = page.getByLabel("机器人昵称");
  for (let index = 1; index <= 5; index += 1) {
    await expect(botNickname).toHaveValue(`机器人 ${index}`);
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await expect(page.getByTestId("host-player")).toHaveCount(index);
  }

  await expect(page.locator(".controller-badge")).toHaveCount(5);
  for (const row of await page.getByTestId("host-player").all()) {
    await expect(row).toContainText("自动控制");
  }

  await page.getByLabel("狼人数").fill("1");
  await page.getByLabel("村民数量").fill("2");
  await page.getByLabel("预言家数量").fill("1");
  await page.getByLabel("女巫数量").fill("1");
  await page.getByLabel("守卫数量").fill("0");
  await page.getByLabel("猎人数量").fill("0");
  await page.getByLabel("白痴数量").fill("0");
  await expect(page.getByTestId("start-readiness")).toHaveText("配置就绪");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "开始游戏" }).click();
  await expect(page.getByRole("heading", { name: "玩家确认身份" })).toBeVisible();

  for (const row of await page.getByTestId("host-player").all()) {
    await expect(row).not.toContainText(/狼人|村民|预言家|女巫/);
  }

  let sawDawn = false;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await page.locator(".game-over-panel").isVisible().catch(() => false)) break;

    const dawnButton = page.getByRole("button", { name: "进入白天流程" });
    if (await dawnButton.isVisible().catch(() => false)) {
      sawDawn = true;
      await dawnButton.click({ force: true, timeout: 500 }).catch(() => undefined);
      continue;
    }

    const exileButton = page.getByRole("button", { name: /进入放逐遗言|进入下一夜/ });
    if (await exileButton.isVisible().catch(() => false)) {
      await exileButton.click({ force: true, timeout: 500 }).catch(() => undefined);
      continue;
    }

    await page.waitForTimeout(50);
  }

  await expect(page.locator(".game-over-panel")).toBeVisible();
  await expect(page.getByRole("heading", { name: /好人胜利|狼人胜利/ })).toBeVisible();
  await expect(page.locator(".revealed-roles article")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "公开聊天复盘" })).toBeVisible();
  await expect(page.getByText("我会根据当前公开信息参与讨论。", { exact: true }).first()).toBeVisible();
  expect(sawDawn).toBe(true);

  await page.getByRole("button", { name: "返回大厅调整" }).click();
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  for (let remaining = 5; remaining > 0; remaining -= 1) {
    await page.getByTestId("host-player").last().getByTitle("移除玩家").click();
    await expect(page.getByTestId("host-player")).toHaveCount(remaining - 1);
  }
});

test("three mobile players complete a full game and start a clean rematch", async ({ browser, page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  const joinUrl = await getLocalJoinUrl(page);
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext({ ...devices["Pixel 7"] })));
  const players = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    for (const [index, player] of players.entries()) {
      await joinPlayer(player, joinUrl, ["林野", "阿岚", "青禾"][index]!);
    }
    await page.getByLabel("狼人数量").fill("1");
    await page.getByLabel("村民数量").fill("1");
    await page.getByLabel("预言家数量").fill("1");
    await page.getByLabel("女巫数量").fill("0");
    await page.getByLabel("守卫数量").fill("0");
    await page.getByLabel("猎人数量").fill("0");
    await page.getByLabel("白痴数量").fill("0");
    await expect(page.getByTestId("start-readiness")).toHaveText("配置就绪");
    await page.getByRole("radio", { name: "自由讨论" }).click();
    await expect(page.getByRole("radio", { name: "自由讨论" })).toHaveAttribute("aria-checked", "true");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "开始游戏" }).click();
    await expect(page.getByRole("heading", { name: "玩家确认身份" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/你的身份是|狼人队友|选择一名玩家查验/);

    const roles = await Promise.all(players.map(async (player) => {
      const role = await player.getByTestId("private-role").textContent();
      await player.getByRole("button", { name: "我已记住身份" }).click();
      return role;
    }));
    expect([...roles].sort()).toEqual(["村民", "狼人", "预言家"]);
    const wolf = players[roles.indexOf("狼人")]!;
    const seer = players[roles.indexOf("预言家")]!;
    const villager = players[roles.indexOf("村民")]!;
    const playerByNickname = new Map(["林野", "阿岚", "青禾"].map((nickname, index) => [nickname, players[index]!]));

    await expect(wolf.getByRole("heading", { name: "选择今晚的目标" })).toBeVisible();
    await expect(seer.locator("body")).not.toContainText("狼人私密协作");
    await wolf.getByRole("button", { name: "空刀", exact: true }).click();
    await wolf.getByRole("button", { name: "确认本次选择" }).click();

    await expect(seer.getByRole("heading", { name: "选择一名玩家查验" })).toBeVisible();
    const wolfNickname = ["林野", "阿岚", "青禾"][roles.indexOf("狼人")]!;
    await seer.getByRole("button", { name: new RegExp(wolfNickname) }).click();
    await expect(page.getByRole("heading", { name: "天亮了" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("查验");

    await page.getByRole("button", { name: "进入白天流程" }).click();
    await expect(villager.getByAltText("身份牌背面")).toBeVisible();
    await expect(villager.getByAltText("村民身份牌")).toHaveCount(0);
    await villager.getByRole("button", { name: "查看身份" }).click();
    await expect(villager.getByAltText("村民身份牌")).toBeVisible();
    await villager.getByRole("button", { name: "收起身份" }).click();
    await expect(villager.getByAltText("身份牌背面")).toBeVisible();
    await expect(villager.getByAltText("村民身份牌")).toHaveCount(0);
    const publicChatTexts = ["首位玩家的公开文字发言", "另一位玩家同时参与讨论"];
    for (let index = 0; index < players.length; index += 1) {
      const currentHeading = page.locator(".host-day-panel h2");
      await expect(currentHeading).toContainText("当前：");
      const currentText = await currentHeading.textContent();
      const nickname = ["林野", "阿岚", "青禾"].find((name) => currentText?.includes(name));
      if (!nickname) throw new Error("无法识别当前发言玩家");
      const speaker = playerByNickname.get(nickname)!;

      for (const player of players) {
        await expect(player.getByLabel("公开发言内容")).toBeVisible();
        if (player !== speaker) {
          await expect(player.getByRole("button", { name: "结束我的发言" })).toHaveCount(0);
        }
      }
      if (index === 0) {
        const otherSpeaker = players.find((player) => player !== speaker)!;
        await speaker.getByLabel("公开发言内容").fill(publicChatTexts[0]!);
        await speaker.getByTitle("发送公开发言").click();
        await otherSpeaker.getByLabel("公开发言内容").fill(publicChatTexts[1]!);
        await otherSpeaker.getByTitle("发送公开发言").click();
        await expect(page.getByLabel("公开文字发言").locator(".chat-message")).toHaveCount(2);
        await expect(page.getByLabel("公开文字发言").locator(".chat-message").nth(0)).toContainText(publicChatTexts[0]!);
        await expect(page.getByLabel("公开文字发言").locator(".chat-message").nth(1)).toContainText(publicChatTexts[1]!);
        for (const player of players) {
          for (const text of publicChatTexts) {
            await expect(player.getByLabel("白天公开聊天").getByText(text, { exact: true })).toBeVisible();
          }
        }

        await speaker.reload();
        await expect(speaker.getByLabel("公开发言内容")).toBeVisible();
        for (const text of publicChatTexts) {
          await expect(speaker.getByLabel("白天公开聊天").getByText(text, { exact: true })).toBeVisible();
        }
      }

      await speaker.getByRole("button", { name: "结束我的发言" }).click();
      await expect(speaker.getByLabel("公开发言内容")).toBeVisible();
      await expect(speaker.getByRole("button", { name: "结束我的发言" })).toHaveCount(0);
      if (index < players.length - 1) {
        await expect(currentHeading).not.toHaveText(currentText ?? "");
      }
    }

    await expect(page.getByRole("heading", { name: "放逐投票" })).toBeVisible();
    const wolfName = ["林野", "阿岚", "青禾"][roles.indexOf("狼人")]!;
    for (const [index, player] of players.entries()) {
      if (roles[index] === "狼人") {
        await player.getByRole("button", { name: "弃票" }).click();
      } else {
        await player.getByRole("button", { name: new RegExp(wolfName) }).click();
      }
      await player.getByRole("button", { name: "确认投票" }).click();
    }

    for (const client of [page, ...players]) {
      await expect(client.getByRole("heading", { name: "好人胜利" })).toBeVisible();
      await expect(client.locator(".revealed-roles article")).toHaveCount(3);
      await expect(client.getByRole("heading", { name: "对局记录" })).toBeVisible();
      await expect(client.getByRole("heading", { name: "公开聊天复盘" })).toBeVisible();
      for (const text of publicChatTexts) {
        await expect(client.getByText(text, { exact: true })).toBeVisible();
      }
    }
    await expect(
      villager.getByRole("heading", { name: "对局记录" }).locator("..")
    ).toContainText("查验");
    await expect(wolf.getByRole("button", { name: "确认本次选择" })).toHaveCount(0);

    await Promise.all([page.reload(), villager.reload()]);
    await expect(page.getByRole("heading", { name: "公开聊天复盘" })).toBeVisible();
    await expect(villager.getByRole("heading", { name: "公开聊天复盘" })).toBeVisible();
    for (const text of publicChatTexts) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(villager.getByText(text, { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "再来一局" }).click();
    await expect(page.getByRole("heading", { name: "玩家确认身份" })).toBeVisible();
    await expect(page.locator(".game-records")).toHaveCount(0);
    for (const player of players) {
      await expect(player.getByRole("button", { name: "我已记住身份" })).toBeVisible();
      await expect(player.locator(".game-records")).toHaveCount(0);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
