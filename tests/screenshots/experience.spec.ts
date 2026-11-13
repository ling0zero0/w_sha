import { expect, test, devices } from "@playwright/test";

test("capture upgraded host and mobile entry", async ({ browser, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/host-experience-upgrade.png", fullPage: true });
  const invitation = await page.evaluate(async () => {
    const response = await fetch("/api/host-bootstrap");
    return (await response.json()).lobby.joinUrl as string;
  });
  const url = new URL(invitation);
  const context = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce" });
  try {
    const player = await context.newPage();
    await player.goto(`${new URL(page.url()).origin}${url.pathname}${url.search}`);
    await expect(player.getByRole("heading", { name: "加入游戏" })).toBeVisible();
    await player.screenshot({ path: "docs/screenshots/player-experience-upgrade.png", fullPage: true });
  } finally {
    await context.close();
  }
});
