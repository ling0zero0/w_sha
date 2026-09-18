"use strict";

const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..", "..");

function createAssert(prefix) {
  const fail = (message) => {
    console.error(`${prefix}${message}`);
    process.exit(1);
  };
  return {
    fail,
    assert(condition, message) {
      if (!condition) fail(message);
    }
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

function getAvailablePort(host = "0.0.0.0") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function getConfiguredPort(defaultPort) {
  const rawPort = process.env.RELEASE_PORT?.trim();
  if (!rawPort) return defaultPort;
  if (!/^\d+$/.test(rawPort)) throw new Error("RELEASE_PORT must be an integer from 0 to 65535");
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("RELEASE_PORT must be an integer from 0 to 65535");
  return port;
}

async function resolveReleasePort(defaultPort) {
  const configuredPort = getConfiguredPort(defaultPort);
  return configuredPort === 0 ? getAvailablePort() : configuredPort;
}

async function stopChild(child, output = []) {
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

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

module.exports = {
  createAssert,
  delay,
  getAvailablePort,
  getConfiguredPort,
  powershellLiteral,
  projectRoot,
  resolveReleasePort,
  selectLanAddress,
  stopChild
};
