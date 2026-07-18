'use strict';

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const productRoot = path.resolve(process.argv[2] ?? '');
const nodePath = path.join(productRoot, 'node.exe');
const entryPath = path.join(productRoot, 'app', 'server', 'dist', 'index.js');
const webRoot = path.join(productRoot, 'app', 'public');
const verificationRoot = path.join(productRoot, '.verification');
const databasePath = path.join(verificationRoot, 'werewolf.sqlite');

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Packaged server did not become ready.');
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  if (!fs.existsSync(nodePath) || !fs.existsSync(entryPath) || !fs.existsSync(webRoot)) {
    throw new Error('Portable package is incomplete.');
  }

  fs.rmSync(verificationRoot, { recursive: true, force: true });
  fs.mkdirSync(verificationRoot, { recursive: true });
  const port = await getAvailablePort();
  let output = '';
  const child = spawn(nodePath, [entryPath], {
    cwd: productRoot,
    windowsHide: true,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      WEB_PORT: String(port),
      NODE_ENV: 'production',
      OPEN_BROWSER: '0',
      WEB_ROOT: webRoot,
      DATABASE_PATH: databasePath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitFor(`${baseUrl}/health`, child);
    const home = await fetch(`${baseUrl}/`);
    const homeBody = await home.text();
    const join = await fetch(`${baseUrl}/join/123456?t=abcdefghijklmnopqrstuvwxyz123456`);
    const hostApi = await fetch(`${baseUrl}/api/host-bootstrap`, {
      headers: { referer: `${baseUrl}/` }
    });

    if (!home.ok || !homeBody.includes('id="root"')) throw new Error('Packaged home page is invalid.');
    if (!join.ok || !(await join.text()).includes('id="root"')) throw new Error('Packaged join route is invalid.');
    if (!hostApi.ok || !(await hostApi.json()).sessionToken) throw new Error('Packaged host API is invalid.');
    if (!fs.existsSync(databasePath)) throw new Error('Packaged database was not created.');
  } catch (error) {
    if (output) console.error(output);
    throw error;
  } finally {
    await stopChild(child);
    fs.rmSync(verificationRoot, { recursive: true, force: true });
  }

  console.log('Portable package verification passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
