'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runtimeDirectory = path.join(projectRoot, '.runtime');
const stateFile = path.join(runtimeDirectory, 'dev-server.json');
const runScript = path.join(__dirname, 'run-project.cmd');
const commandPrompt = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
const windowTitle = 'W_SHA Local Dev Server 8F2C1A';
const webUrl = 'http://127.0.0.1:5173/';
const apiHealthUrl = 'http://127.0.0.1:3000/health';
const portSeed = crypto.createHash('sha256').update(projectRoot.toLowerCase()).digest().readUInt32BE(0);
const controlPort = 41000 + (portSeed % 10000);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rootsMatch(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const valid = state
      && state.version === 1
      && typeof state.projectRoot === 'string'
      && rootsMatch(state.projectRoot, projectRoot)
      && state.controlPort === controlPort
      && Number.isInteger(state.managerPid)
      && typeof state.token === 'string'
      && /^[a-f0-9]{64}$/.test(state.token);

    return valid ? state : null;
  } catch {
    return null;
  }
}

function removeState(expectedToken) {
  const state = readState();
  if (!state || (expectedToken && state.token !== expectedToken)) {
    return;
  }

  try {
    fs.unlinkSync(stateFile);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not remove runtime state: ${error.message}`);
    }
  }
}

function writeState(state) {
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function tokensMatch(provided, expected) {
  const left = Buffer.from(String(provided || ''), 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function controlRequest(state, method, pathname, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: state.controlPort,
      method,
      path: pathname,
      headers: {
        'x-w-sha-token': state.token,
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });

    request.setTimeout(timeout, () => request.destroy(new Error('Control request timed out.')));
    request.on('error', reject);
    request.end();
  });
}

async function getManagedStatus() {
  const state = readState();
  if (!state) {
    return null;
  }

  try {
    const response = await controlRequest(state, 'GET', '/status');
    if (response.statusCode !== 200) {
      return null;
    }

    const status = JSON.parse(response.body);
    return status
      && status.running === true
      && rootsMatch(status.projectRoot, projectRoot)
      ? { state, status }
      : null;
  } catch {
    return null;
  }
}

function isPortOpen(port, timeout = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeout, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function isHttpHealthy(url, timeout = 1000) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });

    request.setTimeout(timeout, () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function waitFor(check, timeout, interval = 300) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) {
      return true;
    }
    await delay(interval);
  } while (Date.now() < deadline);

  return false;
}

function ensureLaunchPrerequisites() {
  if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
    throw new Error(`package.json was not found in ${projectRoot}.`);
  }
  if (!fs.existsSync(path.join(projectRoot, 'node_modules'))) {
    throw new Error('Dependencies are missing. Run "corepack pnpm install" manually first.');
  }

  const whereResult = spawnSync('where.exe', ['corepack.cmd'], { stdio: 'ignore' });
  if (whereResult.status !== 0) {
    throw new Error('Corepack is not installed or is not available in PATH.');
  }
}

function openBrowser() {
  const result = spawnSync(
    commandPrompt,
    ['/d', '/c', 'start', '', webUrl],
    { cwd: projectRoot, stdio: 'ignore', windowsHide: false },
  );

  if (result.status !== 0) {
    console.log(`Open this address in a browser: ${webUrl}`);
  }
}

async function launch() {
  ensureLaunchPrerequisites();

  let managed = await getManagedStatus();
  if (!managed) {
    removeState();

    const occupiedPorts = [];
    if (await isPortOpen(3000)) occupiedPorts.push(3000);
    if (await isPortOpen(5173)) occupiedPorts.push(5173);
    if (occupiedPorts.length > 0) {
      throw new Error(`Port ${occupiedPorts.join(' and ')} is already in use by an unmanaged process.`);
    }

    console.log('Starting the project in a visible command window...');
    const startResult = spawnSync(
      commandPrompt,
      ['/d', '/c', 'start', windowTitle, commandPrompt, '/d', '/c', runScript],
      { cwd: projectRoot, stdio: 'inherit', windowsHide: false },
    );
    if (startResult.status !== 0) {
      throw new Error('The development server window could not be opened.');
    }

    const managerReady = await waitFor(async () => {
      managed = await getManagedStatus();
      return Boolean(managed);
    }, 15000);
    if (!managerReady) {
      throw new Error('The project manager did not start. Check the visible server window.');
    }
  } else {
    console.log('The managed project process is already running.');
  }

  console.log('Waiting for the web and API services...');
  const servicesReady = await waitFor(async () => (
    await isHttpHealthy(webUrl) && await isHttpHealthy(apiHealthUrl)
  ), 45000, 500);
  if (!servicesReady) {
    throw new Error('Startup timed out. Check the visible server window for details.');
  }

  openBrowser();
  console.log('Project started successfully.');
  console.log(`Web: ${webUrl}`);
  console.log(`API health: ${apiHealthUrl}`);
}

async function serve() {
  ensureLaunchPrerequisites();

  let child = null;
  let stopping = false;
  let finalized = false;
  const token = crypto.randomBytes(32).toString('hex');
  const state = {
    version: 1,
    projectRoot,
    managerPid: process.pid,
    controlPort,
    token,
  };

  const finalize = (exitCode) => {
    if (finalized) {
      return;
    }
    finalized = true;
    removeState(token);
    controlServer.close(() => {
      process.exitCode = exitCode;
    });
  };

  const stopChild = (exitCode = 0) => {
    if (stopping) {
      return;
    }
    stopping = true;

    if (child && child.pid && child.exitCode === null) {
      console.log('\nStopping the managed project process tree...');
      const result = spawnSync(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'inherit', windowsHide: false },
      );
      if (result.error) {
        console.error(`Could not stop the managed child process: ${result.error.message}`);
        exitCode = 1;
      }
    }

    finalize(exitCode);
  };

  const controlServer = http.createServer((request, response) => {
    if (!tokensMatch(request.headers['x-w-sha-token'], token)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end('{"error":"forbidden"}\n');
      return;
    }

    if (request.method === 'GET' && request.url === '/status') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({
        running: true,
        projectRoot,
        managerPid: process.pid,
        childPid: child ? child.pid : null,
      })}\n`);
      return;
    }

    if (request.method === 'POST' && request.url === '/stop') {
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end('{"stopping":true}\n');
      setImmediate(() => stopChild(0));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"not found"}\n');
  });

  await new Promise((resolve, reject) => {
    controlServer.once('error', reject);
    controlServer.listen(controlPort, '127.0.0.1', resolve);
  });

  if (await isPortOpen(3000) || await isPortOpen(5173)) {
    controlServer.close();
    throw new Error('Port 3000 or 5173 is already in use. No project process was started.');
  }

  child = spawn(
    commandPrompt,
    ['/d', '/c', 'call corepack pnpm dev'],
    { cwd: projectRoot, stdio: 'inherit', windowsHide: false },
  );

  child.once('error', (error) => {
    console.error(`Could not start the development command: ${error.message}`);
    stopChild(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) {
      const exitCode = Number.isInteger(code) ? code : 1;
      console.log(`\nThe development command exited (${signal || exitCode}).`);
      finalize(exitCode);
    }
  });

  try {
    writeState(state);
  } catch (error) {
    console.error(`Could not write runtime state: ${error.message}`);
    stopChild(1);
    return;
  }

  process.once('SIGINT', () => stopChild(0));
  process.once('SIGBREAK', () => stopChild(0));

  console.log(`Project directory: ${projectRoot}`);
  console.log(`Managed child PID: ${child.pid}`);
  console.log(`Web: ${webUrl}`);
  console.log(`API health: ${apiHealthUrl}`);
  console.log('Use the project close script to stop this process tree.\n');
}

async function stop() {
  const managed = await getManagedStatus();
  if (!managed) {
    removeState();
    console.log('The managed project process is not running.');
    if (await isPortOpen(3000) || await isPortOpen(5173)) {
      console.log('Port 3000 or 5173 is in use by an unmanaged process; it was not terminated.');
    }
    return;
  }

  const response = await controlRequest(managed.state, 'POST', '/stop', 3000);
  if (response.statusCode !== 202) {
    throw new Error(`The project manager rejected the stop request (${response.statusCode}).`);
  }

  const stopped = await waitFor(async () => (
    !(await isPortOpen(3000)) && !(await isPortOpen(5173))
  ), 15000, 300);
  if (!stopped) {
    throw new Error('The managed process received the stop request, but its ports are still open.');
  }

  console.log('Project stopped successfully.');
}

async function status() {
  const managed = await getManagedStatus();
  if (!managed) {
    console.log('The managed project process is not running.');
    process.exitCode = 1;
    return;
  }

  console.log(`The managed project process is running (manager PID ${managed.status.managerPid}).`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'launch') return launch();
  if (command === 'serve') return serve();
  if (command === 'stop') return stop();
  if (command === 'status') return status();
  throw new Error('Usage: node project-manager.cjs <launch|serve|stop|status>');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
