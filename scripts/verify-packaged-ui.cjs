"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium, devices } = require("@playwright/test");

const projectRoot = path.resolve(__dirname, "..");
const productRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, ".runtime", "package-portable", "W_SHA"));
const nodePath = path.join(productRoot, "node.exe");
const entryPath = path.join(productRoot, "app", "server", "dist", "index.js");
const webRoot = path.join(productRoot, "app", "public");

if (process.platform !== "win32") {
  console.error("Packaged UI verification currently supports Windows only.");
  process.exit(1);
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findBrowserExecutable() {
  const candidates = [
    process.env.RELEASE_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function stopChild(child, output) {
  if (child.exitCode === null) child.kill("SIGTERM");
  const gracefulDeadline = Date.now() + 3_000;
  while (child.exitCode === null && Date.now() < gracefulDeadline) {
    await delay(100);
  }

  if (child.exitCode === null) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    await delay(500);
  }

  child.stdout?.destroy();
  child.stderr?.destroy();
  if (child.exitCode !== null && child.exitCode !== 0 && output.length > 0) {
    throw new Error(`packaged server exited with ${child.exitCode}: ${output.join("")}`);
  }
}

async function startServer(port, databasePath) {
  const output = [];
  const child = spawn(nodePath, [entryPath], {
    cwd: productRoot,
    windowsHide: true,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      WEB_PORT: String(port),
      PUBLIC_ADDRESS: "127.0.0.1",
      NODE_ENV: "production",
      OPEN_BROWSER: "0",
      WEB_ROOT: webRoot,
      DATABASE_PATH: databasePath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { child, output };
    } catch {
      // The packaged server is still starting.
    }
    await delay(150);
  }

  await stopChild(child, output).catch(() => undefined);
  throw new Error(`packaged server did not become ready${output.length > 0 ? `: ${output.join("")}` : ""}`);
}

async function verifyPage(browser, baseUrl, route, contextOptions, expectedText, checkOverflow) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.resourceType() !== "websocket") {
      failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
    }
  });

  try {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error(`${route} returned ${response?.status() ?? "no response"}`);
    await page.locator("#root").waitFor({ state: "attached", timeout: 5_000 });
    await page.getByText(expectedText, { exact: true }).first().waitFor({ state: "visible", timeout: 8_000 });

    const layout = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rootText: document.getElementById("root")?.textContent ?? ""
    }));
    if (!layout.rootText.trim()) throw new Error(`${route} rendered an empty application root`);
    if (checkOverflow && layout.scrollWidth > layout.innerWidth + 1) {
      throw new Error(`${route} overflows horizontally: ${layout.scrollWidth}px > ${layout.innerWidth}px`);
    }
    if (pageErrors.length > 0) throw new Error(`${route} raised a page error: ${pageErrors.join("; ")}`);
    if (failedRequests.length > 0) throw new Error(`${route} had failed requests: ${failedRequests.join("; ")}`);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!fs.existsSync(nodePath) || !fs.existsSync(entryPath) || !fs.existsSync(webRoot)) {
    throw new Error(`Portable package is incomplete: ${productRoot}`);
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w-sha-packaged-ui-"));
  const databasePath = path.join(temporaryRoot, "werewolf.sqlite");
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverRun = null;
  let browser = null;

  try {
    serverRun = await startServer(port, databasePath);
    const executablePath = findBrowserExecutable();
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {})
    });
    const joinRoute = "/join/123456?t=abcdefghijklmnopqrstuvwxyz123456";
    await verifyPage(browser, baseUrl, "/", {}, "房间号", false);
    await verifyPage(browser, baseUrl, joinRoute, devices["Pixel 5"], "加入游戏", true);
    await verifyPage(browser, baseUrl, joinRoute, devices["iPhone 12"], "加入游戏", true);
    await verifyPage(
      browser,
      baseUrl,
      joinRoute,
      {
        ...devices["Pixel 5"],
        userAgent: `${devices["Pixel 5"].userAgent} MicroMessenger/8.0.47`
      },
      "加入游戏",
      true
    );

    console.log(
      JSON.stringify(
        {
          passed: true,
          port,
          browser: executablePath ?? "playwright-managed",
          checks: [
            "packaged desktop host UI",
            "packaged Android-sized join UI",
            "packaged iPhone-sized join UI",
            "packaged WeChat user-agent join UI",
            "packaged mobile horizontal overflow"
          ]
        },
        null,
        2
      )
    );
  } finally {
    await browser?.close();
    if (serverRun) await stopChild(serverRun.child, serverRun.output).catch(() => undefined);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
