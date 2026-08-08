'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const portableScript = path.join(__dirname, 'package-portable.cjs');
const candidates = [
  process.env.ISCC_PATH,
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe'
].filter(Boolean);
const compiler = candidates.find((candidate) => fs.existsSync(candidate));

if (!compiler) {
  console.error('Inno Setup 6 was not found. Install it, then run this command again.');
  process.exit(1);
}

let result = spawnSync(process.execPath, [portableScript], { cwd: projectRoot, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

result = spawnSync(compiler, [
  `/DMyAppVersion=${packageJson.version}`,
  path.join(projectRoot, 'installer', 'W_SHA.iss')
], { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
if (result.status !== 0) process.exit(result.status ?? 1);

result = spawnSync(process.execPath, [
  path.join(__dirname, 'verify-release-artifacts.cjs')
], { cwd: projectRoot, stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
