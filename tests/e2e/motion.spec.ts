import { devices, expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { deviceOptions } from "./browser-context";

async function getLocalJoinUrl(page: Page): Promise<string> {
  const joinUrl = await page.evaluate(async () => {
    const response = await fetch("/api/host-bootstrap");
    const payload = (await response.json()) as { lobby: { joinUrl: string } };
    return payload.lobby.joinUrl;
  });
  const invitation = new URL(joinUrl);
  return `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
}

async function removePlayers(page: Page, nicknames: string[]): Promise<void> {
  for (const nickname of nicknames) {
    const row = page.getByTestId("host-player").filter({ hasText: nickname });
    if (await row.count()) {
      await row.getByTitle("移除玩家").click({ force: true });
      await expect(row).toHaveCount(0);
    }
  }
}

async function expectReducedMotion(page: Page): Promise<void> {
  const moving = await page.locator("body *").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      return style.animationName !== "none" || style.transitionDuration.split(",").some((duration) => parseFloat(duration) !== 0)
        ? [`${element.tagName}.${element.getAttribute("class") ?? ""}: ${style.animationName}, ${style.transitionDuration}`]
        : [];
    })
  );
  expect(moving).toEqual([]);
}

test("desktop buttons support hover, visible keyboard focus and Space activation without replaying entry", async ({ browser, page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  const radio = page.getByRole("radio", { name: "有序发言" });
  await expect(radio).toBeEnabled();
  await radio.focus();
  await expect(radio.locator("..")).toHaveCSS("outline-style", "solid");
  await expect(radio.locator("..")).toHaveCSS("outline-width", "3px");

  const context = await browser.newContext({ ...devices["Desktop Chrome"], reducedMotion: "no-preference" });
  const player = await context.newPage();
  const nickname = "键盘动效玩家";
  try {
    await player.goto(await getLocalJoinUrl(page));
    const form = player.locator(".join-form");
    await expect(form).toHaveCSS("animation-name", "content-enter");
    await expect.poll(() => form.evaluate((element) => element.getAnimations().length)).toBe(0);
    await form.evaluate((element) => {
      element.setAttribute("data-entry-replays", "0");
      element.addEventListener("animationstart", () => {
        element.setAttribute("data-entry-replays", String(Number(element.getAttribute("data-entry-replays")) + 1));
      });
    });
    const input = player.getByLabel("昵称");
    await input.fill(nickname);
    await expect(form).toHaveAttribute("data-entry-replays", "0");
    const button = player.getByRole("button", { name: "进入大厅" });
    await expect(button).toBeEnabled();
    const background = await button.evaluate((element) => getComputedStyle(element).backgroundImage);
    await button.hover();
    await expect.poll(() => button.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe(background);
    await expect.poll(() => button.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(-1);

    await player.mouse.down();
    await expect.poll(() => button.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42)).toBe(1);
    await player.mouse.move(0, 0);
    await player.mouse.up();
    await expect(button).toBeEnabled();
    await input.focus();
    await player.keyboard.press("Tab");
    await expect(button).toBeFocused();
    expect(await button.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
    await expect(button).toHaveCSS("outline-width", "3px");
    await player.keyboard.down("Space");
    await player.keyboard.up("Space");
    await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await expect(page.getByTestId("host-player").filter({ hasText: nickname })).toHaveCount(1);
  } finally {
    await removePlayers(page, [nickname]);
    await context.close();
  }
});

test("touch and reduced motion preserve target selection, disabled controls and private card visibility", async ({ browser, page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  await expectReducedMotion(page);
  const joinUrl = await getLocalJoinUrl(page);
  const contexts = await Promise.all(
    [0, 1, 2].map(() =>
      browser.newContext({
        ...deviceOptions(browser, devices["Pixel 7"]),
        viewport: { width: 320, height: 667 },
        reducedMotion: "reduce"
      })
    )
  );
  const players = await Promise.all(contexts.map((context) => context.newPage()));
  const nicknames = ["触控动效甲", "触控动效乙", "触控动效丙"];
  page.on("dialog", (dialog) => dialog.accept());

  try {
    for (const [index, player] of players.entries()) {
      await player.goto(joinUrl);
      await expectReducedMotion(player);
      expect(await player.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
      const button = player.getByRole("button", { name: "进入大厅" });
      await player.getByLabel("昵称").fill(nicknames[index]!);
      await expect(button).toBeEnabled();
      const background = await button.evaluate((element) => getComputedStyle(element).backgroundImage);
      await button.hover();
      await expect(button).toHaveCSS("background-image", background);
      await expect(button).toHaveCSS("transform", "none");
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await button.tap();
      await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    }
    // The same host page in a touch viewport uses opaque panels instead of large blur layers.
    await page.setViewportSize({ width: 320, height: 667 });
    await expect(page.locator(".role-configuration")).toHaveCSS("backdrop-filter", "none");
    await expect(page.locator(".roster")).toHaveCSS("backdrop-filter", "none");
    for (const [label, count] of [
      ["狼人数量", "1"],
      ["村民数量", "1"],
      ["预言家数量", "1"],
      ["女巫数量", "0"],
      ["守卫数量", "0"],
      ["猎人数量", "0"],
      ["白痴数量", "0"]
    ]) {
      await page.getByLabel(label!).fill(count!);
    }
    await expect(page.getByTestId("start-readiness")).toHaveText("配置就绪");
    await page.getByRole("button", { name: "开始游戏" }).click();
    const roles = await Promise.all(
      players.map(async (player) => {
        await expect(player.getByTestId("private-role")).toBeVisible();
        const role = await player.getByTestId("private-role").textContent();
        await player.getByRole("button", { name: "我已记住身份" }).tap();
        return role;
      })
    );
    const wolf = players[roles.indexOf("狼人")]!;
    const seer = players[roles.indexOf("预言家")]!;
    const villager = players[roles.indexOf("村民")]!;
    const confirm = wolf.getByRole("button", { name: "确认本次选择" });
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveCSS("transform", "none");
    const target = wolf.locator(".night-targets button").first();
    await target.tap();
    await expect(target).toHaveClass("is-selected");
    await expect(target).not.toHaveCSS("box-shadow", "none");
    await expect(target).toHaveCSS("transform", "none");
    await wolf.getByRole("button", { name: "空刀", exact: true }).tap();
    await expect(target).not.toHaveClass("is-selected");
    await expect(wolf.getByRole("button", { name: "空刀", exact: true })).toHaveClass("is-selected");
    await confirm.tap();
    await expect(wolf.getByText("狼人行动已锁定", { exact: true })).toBeVisible();
    await expectReducedMotion(wolf);
    await expect(seer.getByRole("heading", { name: "选择一名玩家查验" })).toBeVisible();
    await seer.locator(".night-targets button").first().tap();
    await expect(page.getByRole("heading", { name: "天亮了" })).toBeVisible();
    await page.getByRole("button", { name: "进入白天流程" }).click();
    // Freeze the phase while checking local card privacy; WebKit input can outlast a short test turn.
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(page.getByRole("button", { name: "继续", exact: true })).toBeEnabled();

    const front = villager.locator(".day-role-card-front");
    const back = villager.locator(".day-role-card-back");
    await expect(front).toBeHidden();
    await expect(back).toBeVisible();
    await expect(villager.getByAltText("村民身份牌")).toHaveCount(0);
    const reveal = villager.getByRole("button", { name: "查看身份" });
    await reveal.focus();
    await villager.keyboard.press("Enter");
    await expect(front).toBeVisible();
    await expect(back).toBeHidden();
    await expect(villager.locator(".day-role-card-inner")).toHaveCSS("transform", "none");
    await expect(villager.getByAltText("村民身份牌")).toBeVisible();
    await villager.getByRole("button", { name: "收起身份" }).tap();
    await expect(front).toBeHidden();
    await expect(back).toBeVisible();
    await expect(villager.getByAltText("村民身份牌")).toHaveCount(0);
    await expectReducedMotion(villager);
  } finally {
    const terminate = page.getByRole("button", { name: "终止对局" });
    if (await terminate.isEnabled()) {
      await terminate.click();
      await expect(page.getByRole("button", { name: "返回大厅调整" })).toBeVisible();
    }
    const returnToLobby = page.getByRole("button", { name: "返回大厅调整" });
    if (await returnToLobby.count()) await returnToLobby.click();
    await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
    await removePlayers(page, nicknames);
    await Promise.all(contexts.map((context) => context.close()));
  }
});
