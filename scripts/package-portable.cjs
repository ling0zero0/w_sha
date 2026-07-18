'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const releaseRoot = path.join(projectRoot, 'release');
const stagingRoot = path.join(projectRoot, '.runtime', 'package-portable');
const productRoot = path.join(stagingRoot, 'W_SHA');
const deployRoot = path.join(stagingRoot, 'server-deploy');
const archivePath = path.join(releaseRoot, `W_SHA-portable-${packageJson.version}.zip`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: true,
    shell: options.shell ?? false,
    env: { ...process.env, CI: 'true' }
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true, dereference: true });
}

if (process.platform !== 'win32') {
  console.error('Portable packaging currently supports Windows only.');
  process.exit(1);
}

const nodePath = process.execPath;
if (!fs.existsSync(nodePath)) {
  console.error(`Node.js executable was not found: ${nodePath}`);
  process.exit(1);
}

fs.rmSync(stagingRoot, { recursive: true, force: true });
fs.mkdirSync(productRoot, { recursive: true });
fs.mkdirSync(releaseRoot, { recursive: true });
fs.rmSync(archivePath, { force: true });

run('corepack.cmd', ['pnpm', 'check'], { shell: true });
run('corepack.cmd', [
  'pnpm', '--filter', '@werewolf/server', 'deploy', '--prod', '--legacy', deployRoot
], { shell: true });

fs.copyFileSync(nodePath, path.join(productRoot, 'node.exe'));
copyDirectory(path.join(projectRoot, 'release-template'), productRoot);
copyDirectory(path.join(projectRoot, 'apps', 'web', 'dist'), path.join(productRoot, 'app', 'public'));
copyDirectory(deployRoot, path.join(productRoot, 'app', 'server'));
copyDirectory(
  path.join(deployRoot, 'node_modules', '.pnpm', 'node_modules'),
  path.join(productRoot, 'app', 'server', 'node_modules')
);
for (const entry of ['.bin', '.modules.yaml', '.pnpm']) {
  fs.rmSync(path.join(productRoot, 'app', 'server', 'node_modules', entry), {
    recursive: true,
    force: true
  });
}

for (const entry of ['src', '.runtime', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts']) {
  fs.rmSync(path.join(productRoot, 'app', 'server', entry), { recursive: true, force: true });
}

run(process.execPath, [path.join(__dirname, 'verify-portable.cjs'), productRoot]);

run('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `Compress-Archive -LiteralPath '${productRoot.replaceAll("'", "''")}' -DestinationPath '${archivePath.replaceAll("'", "''")}' -CompressionLevel Optimal -Force`
]);
run('corepack.cmd', ['pnpm', 'install', '--offline'], { shell: true });

console.log(`Portable package created: ${archivePath}`);
