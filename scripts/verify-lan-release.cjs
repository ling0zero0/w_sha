"use strict";

const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const productRoot = path.resolve(process.argv[2] ?? path.join(projectRoot, ".runtime", "package-portable", "W_SHA"));
const lanAddress = process.env.LAN_ADDRESS ?? process.argv[3] ?? selectLanAddress();
const nodePath = path.join(productRoot, "node.exe");
const entryPath = path.join(productRoot, "app", "server", "dist", "index.js");
const webRoot = path.join(productRoot, "app", "public");
const socketClientPath = path.join(projectRoot, "apps", "server", "node_modules", "socket.io-client");
const DEFAULT_RELEASE_PORT = 35173;

if (process.platform !== "win32") {
  console.error("LAN release verification currently supports Windows only.");
  process.exit(1);
}

if (!fs.existsSync(socketClientPath)) {
  console.error("socket.io-client is missing. Run corepack pnpm install first.");
  process.exit(1);
}

const { io } = require(socketClientPath);

function selectLanAddress() {
  const candidates = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));
  if (candidates.length === 0) {
    throw new Error("No private IPv4 address was found. Set LAN_ADDRESS explicitly.");
  }
  return candidates[0];
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function getConfiguredPort() {
  const rawPort = process.env.RELEASE_PORT?.trim();
  if (!rawPort) return DEFAULT_RELEASE_PORT;
  if (!/^\d+$/.test(rawPort)) {
    throw new Error("RELEASE_PORT must be an integer from 0 to 65535");
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("RELEASE_PORT must be an integer from 0 to 65535");
  }
  return port;
}

async function resolveReleasePort() {
  const configuredPort = getConfiguredPort();
  return configuredPort === 0 ? getAvailablePort() : configuredPort;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const childEnvironment = { ...process.env };
  delete childEnvironment.AI_MASTER_KEY;
  const child = spawn(nodePath, [entryPath], {
    cwd: productRoot,
    windowsHide: true,
    env: {
      ...childEnvironment,
      HOST: "0.0.0.0",
      PORT: String(port),
      WEB_PORT: String(port),
      PUBLIC_ADDRESS: lanAddress,
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

function connectSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ["websocket"],
      timeout: 5_000,
      ...options
    });
    const onError = (error) => {
      socket.close();
      reject(error);
    };
    socket.once("connect", () => {
      socket.off("connect_error", onError);
      resolve(socket);
    });
    socket.once("connect_error", onError);
  });
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5_000).emit(event, payload, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 5_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  if (!fs.existsSync(nodePath) || !fs.existsSync(entryPath) || !fs.existsSync(webRoot)) {
    throw new Error(`Portable package is incomplete: ${productRoot}`);
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w-sha-lan-release-"));
  const databasePath = path.join(temporaryRoot, "werewolf.sqlite");
  let firstRun = null;
  let secondRun = null;
  let hostSocket = null;
  let playerSocket = null;
  let secondarySocket = null;

  try {
    const port = await resolveReleasePort();
    const loopbackUrl = `http://127.0.0.1:${port}`;
    const lanUrl = `http://${lanAddress}:${port}`;
    firstRun = await startServer(port, databasePath);

    const health = await fetch(`${lanUrl}/health`);
    if (!health.ok) throw new Error("LAN health endpoint is not reachable");
    const masterKeyPath = path.join(temporaryRoot, "ai-master-key");
    const masterKey = fs.readFileSync(masterKeyPath, "utf8");
    if (process.platform === "win32" && !masterKey.startsWith("dpapi:v1:")) {
      throw new Error("packaged Windows runtime did not protect the AI master key with DPAPI");
    }
    const home = await fetch(`${lanUrl}/`);
    if (!home.ok || !(await home.text()).includes('id="root"')) throw new Error("LAN home page is invalid");

    const bootstrapResponse = await fetch(`${loopbackUrl}/api/host-bootstrap`, {
      headers: { origin: loopbackUrl, referer: `${loopbackUrl}/` }
    });
    if (!bootstrapResponse.ok) throw new Error(`host bootstrap failed: ${bootstrapResponse.status}`);
    if (bootstrapResponse.headers.get("cache-control") !== "no-store") {
      throw new Error("host bootstrap must disable caching");
    }
    const bootstrap = await bootstrapResponse.json();
    const joinUrl = new URL(bootstrap.lobby.joinUrl);
    if (bootstrap.lobby.localAddress !== lanAddress) {
      throw new Error(`unexpected advertised LAN address: ${bootstrap.lobby.localAddress}`);
    }
    if (joinUrl.hostname !== lanAddress || joinUrl.port !== String(port)) {
      throw new Error(`invalid LAN join URL: ${joinUrl}`);
    }
    const joinToken = joinUrl.searchParams.get("t");
    if (!joinToken) throw new Error("LAN join URL does not contain a token");

    const joinPage = await fetch(joinUrl);
    if (!joinPage.ok || !(await joinPage.text()).includes('id="root"')) throw new Error("LAN join route is invalid");

    const remoteBootstrap = await fetch(`${lanUrl}/api/host-bootstrap`, {
      headers: { origin: lanUrl, referer: `${lanUrl}/` }
    });
    if (remoteBootstrap.status !== 403) {
      throw new Error(`host bootstrap is accessible from a LAN source: ${remoteBootstrap.status}`);
    }

    let rejectedOrigin = false;
    try {
      await connectSocket(lanUrl, { extraHeaders: { origin: "http://evil.example" } });
    } catch {
      rejectedOrigin = true;
    }
    if (!rejectedOrigin) throw new Error("unexpectedly accepted a disallowed Socket.IO origin");

    hostSocket = await connectSocket(lanUrl, {
      auth: { hostSession: bootstrap.sessionToken },
      extraHeaders: { origin: lanUrl }
    });
    playerSocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const joinActionId = randomUUID();
    const joinPayload = {
      roomCode: bootstrap.lobby.roomCode,
      joinToken,
      nickname: "局域网验收玩家",
      actionId: joinActionId
    };
    const joined = await emitWithAck(playerSocket, "player:join", joinPayload);
    if (!joined?.ok) throw new Error(`player join failed: ${JSON.stringify(joined)}`);
    let credentials = joined.data.credentials;
    playerSocket.close();
    playerSocket = null;
    await delay(300);
    playerSocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const replayedJoin = await emitWithAck(playerSocket, "player:join", joinPayload);
    if (JSON.stringify(replayedJoin) !== JSON.stringify(joined)) {
      throw new Error("cross-socket join replay did not return the original result");
    }

    const takeoverPayload = {
      roomCode: bootstrap.lobby.roomCode,
      joinToken,
      nickname: "局域网验收玩家",
      actionId: randomUUID()
    };
    secondarySocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const takeoverRequested = await emitWithAck(secondarySocket, "player:request-takeover", takeoverPayload);
    if (!takeoverRequested?.ok) {
      throw new Error(`takeover request failed: ${JSON.stringify(takeoverRequested)}`);
    }
    secondarySocket.close();
    secondarySocket = null;
    await delay(300);
    secondarySocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const replayedTakeover = await emitWithAck(secondarySocket, "player:request-takeover", takeoverPayload);
    if (JSON.stringify(replayedTakeover) !== JSON.stringify(takeoverRequested)) {
      throw new Error("cross-socket takeover replay did not return the original result");
    }
    const approval = waitForEvent(secondarySocket, "player:takeover-approved");
    const resolvedTakeover = await emitWithAck(hostSocket, "host:resolve-takeover", {
      requestId: takeoverRequested.data.requestId,
      approved: true,
      actionId: randomUUID()
    });
    if (!resolvedTakeover?.ok) {
      throw new Error(`takeover approval failed: ${JSON.stringify(resolvedTakeover)}`);
    }
    const takeoverSession = await approval;
    if (!takeoverSession?.credentials?.reconnectToken) {
      throw new Error("takeover approval did not deliver a player session");
    }
    credentials = takeoverSession.credentials;
    secondarySocket.close();
    secondarySocket = null;
    await delay(300);
    secondarySocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const preRestartReconnectPayload = {
      ...credentials,
      actionId: randomUUID()
    };
    const preRestartReconnect = await emitWithAck(secondarySocket, "player:reconnect", preRestartReconnectPayload);
    if (!preRestartReconnect?.ok) {
      throw new Error(`approved takeover credential failed before restart: ${JSON.stringify(preRestartReconnect)}`);
    }
    secondarySocket.close();
    secondarySocket = null;
    hostSocket.close();
    hostSocket = null;
    playerSocket.close();
    playerSocket = null;
    await delay(300);
    await stopChild(firstRun.child, firstRun.output);
    firstRun = null;

    secondRun = await startServer(port, databasePath);
    const restoredResponse = await fetch(`${loopbackUrl}/api/host-bootstrap`, {
      headers: { origin: loopbackUrl, referer: `${loopbackUrl}/` }
    });
    const restored = await restoredResponse.json();
    if (restored.lobby.roomCode !== bootstrap.lobby.roomCode) throw new Error("room code did not survive restart");
    if (!restored.lobby.players.some((player) => player.nickname === "局域网验收玩家")) {
      throw new Error("joined player did not survive restart");
    }

    playerSocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const replayedReconnectAfterRestart = await emitWithAck(playerSocket, "player:reconnect", preRestartReconnectPayload);
    if (JSON.stringify(replayedReconnectAfterRestart) !== JSON.stringify(preRestartReconnect)) {
      throw new Error("cross-restart action replay did not return the original result");
    }
    if (replayedReconnectAfterRestart.data.lobby.players.filter((player) => player.nickname === "局域网验收玩家").length !== 1) {
      throw new Error("cross-restart action replay created a duplicate player");
    }
    playerSocket.close();
    playerSocket = null;
    await delay(300);

    playerSocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const reconnectActionId = randomUUID();
    const reconnectPayload = {
      ...credentials,
      actionId: reconnectActionId
    };
    const reconnected = await emitWithAck(playerSocket, "player:reconnect", reconnectPayload);
    if (!reconnected?.ok) throw new Error(`player reconnect failed: ${JSON.stringify(reconnected)}`);
    playerSocket.close();
    playerSocket = null;
    await delay(300);
    playerSocket = await connectSocket(lanUrl, { extraHeaders: { origin: lanUrl } });
    const replayedReconnect = await emitWithAck(playerSocket, "player:reconnect", reconnectPayload);
    if (!replayedReconnect?.ok) {
      throw new Error(`player reconnect replay failed: ${JSON.stringify(replayedReconnect)}`);
    }
    if (JSON.stringify(replayedReconnect) !== JSON.stringify(reconnected)) {
      throw new Error("cross-socket reconnect replay did not return the original result");
    }
    if (replayedReconnect.data.lobby.players.filter((player) => player.nickname === "局域网验收玩家").length !== 1) {
      throw new Error("reconnect replay created a duplicate player");
    }
    await stopChild(secondRun.child, secondRun.output);
    secondRun = null;

    console.log(
      JSON.stringify(
        {
          passed: true,
          lanAddress,
          port,
          checks: [
            "LAN HTTP",
            "Windows DPAPI master key at rest",
            "LAN join route",
            "host bootstrap local-only",
            "host bootstrap no-store",
            "Socket.IO origin allowlist",
            "Socket.IO LAN origin",
            "cross-socket lifecycle action replay",
            "cross-restart action replay",
            "takeover approval session recovery",
            "approved takeover credential before restart",
            "snapshot restart recovery",
            "player reconnect"
          ]
        },
        null,
        2
      )
    );
  } finally {
    playerSocket?.close();
    secondarySocket?.close();
    hostSocket?.close();
    if (firstRun) await stopChild(firstRun.child, firstRun.output).catch(() => undefined);
    if (secondRun) await stopChild(secondRun.child, secondRun.output).catch(() => undefined);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
