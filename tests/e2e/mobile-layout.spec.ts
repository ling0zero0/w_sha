import { devices, expect, test, type Page } from "@playwright/test";

type Viewport = { width: number; height: number };

async function getLocalJoinUrl(page: Page): Promise<string> {
  const joinUrl = await page.evaluate(async () => {
    const response = await fetch("/api/host-bootstrap");
    const payload = (await response.json()) as { lobby: { joinUrl: string } };
    return payload.lobby.joinUrl;
  });
  const invitation = new URL(joinUrl);
  return `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const audit = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const elements = [...document.querySelectorAll<HTMLElement>("body *")];
    const overflowers = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className,
          right: Math.round(rect.right),
          left: Math.round(rect.left)
        };
      })
      .filter(({ right, left }) => right > viewport + 1 || left < -1)
      .slice(0, 8);
    return {
      viewport,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      overflowers
    };
  });

  expect(audit.scrollWidth, JSON.stringify(audit)).toBeLessThanOrEqual(audit.viewport + 1);
  expect(audit.overflowers, JSON.stringify(audit)).toEqual([]);
}

async function assertTouchTargets(page: Page): Promise<void> {
  const undersized = await page.locator("button:visible, input:visible, textarea:visible, select:visible").evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          name: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("title") || "",
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
      .filter(({ width, height }) => width < 44 || height < 44)
  );

  expect(undersized).toEqual([]);
}

async function assertKeyboardFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      name: element.getAttribute("aria-label") || element.textContent?.trim() || "",
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow
    };
  });

  expect(focus).not.toBeNull();
  expect(focus?.focusVisible, JSON.stringify(focus)).toBe(true);
  expect(focus?.outlineStyle !== "none" || focus?.boxShadow !== "none", JSON.stringify(focus)).toBe(true);
}

test("host and player surfaces remain usable at narrow mobile sizes", async ({ browser, page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertTouchTargets(page);
  await assertKeyboardFocus(page);

  const joinUrl = await getLocalJoinUrl(page);
  const invitation = new URL(joinUrl);
  const localJoinUrl = `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: { width: 320, height: 667 }
  });
  const player = await context.newPage();

  try {
    await player.goto(localJoinUrl);
    await expect(player.getByRole("heading", { name: "加入游戏" })).toBeVisible();
    await assertNoHorizontalOverflow(player);
    await assertTouchTargets(player);
    await assertKeyboardFocus(player);

    await player.getByLabel("昵称").fill("窄屏玩家");
    await player.getByRole("button", { name: "进入大厅" }).click();
    await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
    await assertNoHorizontalOverflow(player);
    await assertNoHorizontalOverflow(page);
  } finally {
    const row = page.getByTestId("host-player").filter({ hasText: "窄屏玩家" });
    if (await row.count()) {
      await row.getByTitle("移除玩家").click({ force: true });
      await expect(page.getByTestId("host-player").filter({ hasText: "窄屏玩家" })).toHaveCount(0);
    }
    await context.close();
  }
});

test("player join layout remains usable in portrait, large text, and landscape viewports", async ({ browser, page }) => {
  await page.goto("/");
  const joinUrl = await getLocalJoinUrl(page);
  const invitation = new URL(joinUrl);
  const localJoinUrl = `${new URL(page.url()).origin}${invitation.pathname}${invitation.search}`;
  const viewports: Viewport[] = [
    { width: 320, height: 667 },
    { width: 393, height: 852 },
    { width: 667, height: 320 }
  ];

  for (const [index, viewport] of viewports.entries()) {
    const context = await browser.newContext({
      ...devices["Pixel 7"],
      viewport,
      extraHTTPHeaders: {
        "X-Test-Viewport": `${viewport.width}x${viewport.height}`
      }
    });
    const player = await context.newPage();
    const nickname = `视口玩家${index + 1}`;

    try {
      await player.goto(localJoinUrl);
      await assertNoHorizontalOverflow(player);
      await assertTouchTargets(player);
      await assertKeyboardFocus(player);
      await player.getByLabel("昵称").fill(nickname);
      await player.getByRole("button", { name: "进入大厅" }).click();
      await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
      await assertNoHorizontalOverflow(player);
    } finally {
      const row = page.getByTestId("host-player").filter({ hasText: nickname });
      if (await row.count()) {
        await row.getByTitle("移除玩家").click({ force: true });
        await expect(page.getByTestId("host-player").filter({ hasText: nickname })).toHaveCount(0);
      }
      await context.close();
    }
  }
});

test("Android Chrome, iPhone Safari, and WeChat browser profiles can join", async ({ browser, page }) => {
  await page.goto("/");
  const joinUrl = await getLocalJoinUrl(page);
  const profiles = [
    { name: "安卓玩家", device: devices["Pixel 7"] },
    { name: "苹果玩家", device: devices["iPhone 13"] },
    {
      name: "微信玩家",
      device: {
        ...devices["Pixel 7"],
        userAgent: `${devices["Pixel 7"].userAgent} MicroMessenger/8.0.49.2800(0x28003138) WeChat/arm64 Weixin NetType/WIFI`
      }
    }
  ];

  for (const profile of profiles) {
    const context = await browser.newContext(profile.device);
    const player = await context.newPage();

    try {
      await player.goto(joinUrl);
      await expect(player.getByRole("heading", { name: "加入游戏" })).toBeVisible();
      await assertNoHorizontalOverflow(player);
      await assertTouchTargets(player);
      await player.getByLabel("昵称").fill(profile.name);
      await player.getByRole("button", { name: "进入大厅" }).click();
      await expect(player.getByRole("heading", { name: "已进入大厅" })).toBeVisible();
      await assertNoHorizontalOverflow(player);
    } finally {
      const row = page.getByTestId("host-player").filter({ hasText: profile.name });
      if (await row.count()) {
        await row.getByTitle("移除玩家").click({ force: true });
        await expect(page.getByTestId("host-player").filter({ hasText: profile.name })).toHaveCount(0);
      }
      await context.close();
    }
  }
});
