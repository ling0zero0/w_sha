'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const managerScript = path.join(__dirname, 'project-manager.cjs');

const generatedPaths = [
  'apps/server/dist',
  'apps/web/dist',
  'packages/shared/dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.runtime',
  'dev-server.log',
  'dev-server-error.log',
];

function resolveProjectPath(relativePath) {
  const target = path.resolve(projectRoot, relativePath);
  const relative = path.relative(projectRoot, target);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean a path outside the project: ${target}`);
  }

  return target;
}

const status = spawnSync(process.execPath, [managerScript, 'status'], {
  cwd: projectRoot,
  stdio: 'ignore',
  windowsHide: true,
});

if (status.status === 0) {
  console.error('ERROR: The project is running. Use the close script before cleaning.');
  process.exit(1);
}

let removed = 0;
for (const relativePath of generatedPaths) {
  const target = resolveProjectPath(relativePath);
  if (!fs.existsSync(target)) {
    continue;
  }

  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${relativePath}`);
  removed += 1;
}

console.log(removed > 0 ? `Cleaned ${removed} generated paths.` : 'Nothing to clean.');
