"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const releaseRoot = path.join(projectRoot, "release");
const portablePath = path.join(releaseRoot, `W_SHA-portable-${packageJson.version}.zip`);
const installerPath = path.join(releaseRoot, `W_SHA-Setup-${packageJson.version}.exe`);

function fail(message) {
  throw new Error(`Release artifact verification failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractPortableArchive(destinationPath) {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Expand-Archive -LiteralPath ${powershellLiteral(portablePath)} -DestinationPath ${powershellLiteral(destinationPath)} -Force`
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    fail(`could not extract the portable archive${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
}

function verifyFile(filePath, label, minimumBytes = 1) {
  assert(fs.existsSync(filePath), `${label} is missing: ${path.relative(projectRoot, filePath)}`);
  const stats = fs.statSync(filePath);
  assert(stats.isFile(), `${label} is not a file: ${path.relative(projectRoot, filePath)}`);
  assert(stats.size >= minimumBytes, `${label} is unexpectedly small: ${stats.size} bytes`);
}

function verifyInstallerHeader() {
  const header = Buffer.alloc(2);
  const descriptor = fs.openSync(installerPath, "r");
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  assert(header.toString("ascii") === "MZ", "installer does not have a Windows PE header");
}

function main() {
  assert(process.platform === "win32", "release artifact verification currently supports Windows only");
  verifyFile(portablePath, "portable archive", 1024 * 1024);
  verifyFile(installerPath, "installer", 1024 * 1024);
  verifyInstallerHeader();

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w-sha-release-artifacts-"));
  try {
    extractPortableArchive(extractionRoot);
    const packagedRoot = path.join(extractionRoot, "W_SHA");
    for (const relativePath of ["node.exe", "启动狼人杀.cmd", "app/public/index.html", "app/server/dist/index.js", "app/server/package.json"]) {
      verifyFile(path.join(packagedRoot, relativePath), `portable entry ${relativePath}`);
    }
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        passed: true,
        version: packageJson.version,
        artifacts: [
          { name: path.basename(portablePath), sha256: sha256(portablePath) },
          { name: path.basename(installerPath), sha256: sha256(installerPath) }
        ],
        checks: ["versioned portable archive", "portable archive required entries", "versioned Windows installer", "Windows PE installer header"]
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
