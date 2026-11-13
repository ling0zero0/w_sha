import { expect, test as base, type Page } from "@playwright/test";

async function resetLobby(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("socket-status")).toContainText("实时已连接");
  const accept = (dialog: import("@playwright/test").Dialog) => dialog.accept();
  page.on("dialog", accept);
  try {
    const terminate = page.getByRole("button", { name: "终止对局" });
    if ((await terminate.count()) && (await terminate.isEnabled())) {
      await terminate.click();
      await expect(page.getByRole("button", { name: "返回大厅调整" })).toBeVisible();
    }
    const returnToLobby = page.getByRole("button", { name: "返回大厅调整" });
    if (await returnToLobby.count()) await returnToLobby.click();
    await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
    const rows = page.getByTestId("host-player");
    while (await rows.count()) {
      const count = await rows.count();
      await rows.first().getByTitle("移除玩家").click();
      await expect(rows).toHaveCount(count - 1);
    }
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
    const ordered = page.getByRole("radio", { name: "有序发言" });
    await ordered.locator("..").click();
    await expect(ordered).toBeChecked();
  } finally {
    page.off("dialog", accept);
  }
}

export const test = base.extend<{ cleanLobby: void }>({
  cleanLobby: [
    async ({ page }, use) => {
      await resetLobby(page);
      try {
        await use();
      } finally {
        await resetLobby(page);
      }
    },
    { auto: true }
  ]
});
