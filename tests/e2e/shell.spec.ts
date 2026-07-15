import { expect, test } from "@playwright/test";

test("host shell reports a connected service", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "局域网狼人杀" })).toBeVisible();
  await expect(page.getByTestId("api-status")).toHaveText("运行中");
  await expect(page.getByTestId("socket-status")).toHaveText("已连接");
});

test("player entry is usable on a mobile viewport", async ({ page }) => {
  await page.goto("/join");

  await expect(page.getByRole("heading", { name: "加入房间" })).toBeVisible();
  await page.getByLabel("房间号").fill("123456");
  await page.getByLabel("昵称").fill("林野");
  await page.getByRole("button", { name: "查找房间" }).click();
  await expect(page.getByRole("status")).toHaveText("当前没有开放的房间");
});

