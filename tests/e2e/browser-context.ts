import type { Browser, BrowserContextOptions } from "@playwright/test";

// Firefox supports touch/viewport emulation, but not the isMobile context option.
export function deviceOptions(browser: Browser, device: BrowserContextOptions): BrowserContextOptions {
  return browser.browserType().name() === "firefox" ? { ...device, isMobile: false } : device;
}
