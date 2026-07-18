'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runtimeDirectory = path.join(projectRoot, '.runtime');
const stateFile = path.join(runtimeDirectory, 'dev-process.json');
const commandPrompt = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
const token = crypto.randomBytes(16).toString('hex');
const apiPort = Number(process.env.PORT || 3000);
const webPort = Number(process.env.WEB_PORT || 5173);
const webUrl = `http://127.0.0.1:${webPort}/?w_sha_launch=${token}`;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function isWebReady() {
  return new Promise((resolve) => {
    const request = http.get(webUrl, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve(
          response.statusCode >= 200
          && response.statusCode < 400
          && body.includes('data-app="werewolf-lan"')
        );
      });
    });
    request.setTimeout(1000, () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function openBrowserWhenReady() {
  const deadline = Date.now() + 45_000;
  while (child.exitCode === null && Date.now() < deadline) {
    if (await isWebReady()) {
      const browser = spawn(commandPrompt, ['/d', '/c', 'start', '', webUrl], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      browser.unref();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (child.exitCode === null) {
    console.error(`The browser was not opened because ${webUrl} did not become ready.`);
  }
}

let child;

function removeOwnState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.token === token) fs.unlinkSync(stateFile);
  } catch {
    // The stop script may already have removed the state file.
  }
}

async function main() {
  const occupiedPorts = [];
  if (await isPortInUse(apiPort)) occupiedPorts.push(apiPort);
  if (await isPortInUse(webPort)) occupiedPorts.push(webPort);
  if (occupiedPorts.length > 0) {
    throw new Error(
      `Port ${occupiedPorts.join(' and ')} is already in use. Stop the other project before starting W_SHA.`
    );
  }

  fs.mkdirSync(runtimeDirectory, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify({
    version: 1,
    projectRoot,
    pid: process.pid,
    token,
  }, null, 2)}\n`, 'utf8');

  child = spawn(commandPrompt, ['/d', '/c', 'call corepack pnpm dev'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  child.once('error', (error) => {
    console.error(`ERROR: Could not start the development command: ${error.message}`);
    removeOwnState();
    process.exitCode = 1;
  });

  child.once('exit', (code) => {
    removeOwnState();
    process.exitCode = Number.isInteger(code) ? code : 1;
  });

  process.once('exit', removeOwnState);
  void openBrowserWhenReady();
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
