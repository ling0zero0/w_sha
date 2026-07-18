'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const stateFile = path.join(projectRoot, '.runtime', 'dev-process.json');

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (
      state.version !== 1
      || path.resolve(state.projectRoot).toLowerCase() !== projectRoot.toLowerCase()
      || !Number.isInteger(state.pid)
    ) return null;
    return state;
  } catch {
    return null;
  }
}

function getCommandLine(pid) {
  const command = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

const state = readState();
if (!state) {
  console.log('The project is not running.');
  process.exit(0);
}

const commandLine = getCommandLine(state.pid).toLowerCase();
const expectedScript = path.join(projectRoot, 'scripts', 'dev-runner.cjs').toLowerCase();
if (!commandLine.includes(expectedScript)) {
  fs.rmSync(stateFile, { force: true });
  console.log('The project is not running. Removed a stale process record.');
  process.exit(0);
}

const result = spawnSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], {
  stdio: 'ignore',
  windowsHide: true,
});
fs.rmSync(stateFile, { force: true });

if (result.status !== 0) {
  console.error('ERROR: The project process could not be stopped.');
  process.exit(1);
}

console.log('Project stopped.');
