import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("AI tabs support arrow keys, wrapping and named panels", async ({ page }) => {
  await page.goto("/ai");
  const providers = page.getByRole("tab", { name: /服务连接/ });
  const models = page.getByRole("tab", { name: /模型/ });
  const profiles = page.getByRole("tab", { name: /机器人档案/ });
  await expect(providers).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName(/服务连接/);
  await providers.focus();
  await page.keyboard.press("ArrowRight");
  await expect(models).toBeFocused();
  await expect(models).toHaveAttribute("aria-selected", "true");
  await expect(providers).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName(/模型/);
  await page.keyboard.press("End");
  await expect(profiles).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(providers).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(profiles).toBeFocused();
  await page.keyboard.press("Home");
  await expect(providers).toBeFocused();
});

test("clipboard permission failure exposes a selectable complete invitation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        }
      }
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "等待玩家加入" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.scene)).toBe("waiting-hall");
  await page.getByTitle("复制加入链接").click();
  await expect(page.getByRole("status").filter({ hasText: "浏览器无法自动复制" })).toBeVisible();
  const fallback = page.getByLabel("完整加入链接");
  const value = await fallback.inputValue();
  expect(new URL(value).pathname).toMatch(/^\/join\/\d{6}$/);
  expect(new URL(value).search.length).toBeGreaterThan(0);
  await fallback.focus();
  expect(await fallback.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!)).toBe(value.length);
});
