"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

function fail(message) {
  console.error(`Repository verification failed: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function resolveProjectPath(relativePath) {
  const target = path.resolve(projectRoot, relativePath);
  const relative = path.relative(projectRoot, target);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `invalid repository path: ${relativePath}`);
  return target;
}

function sourceFiles(rootPath) {
  const files = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (/\.(?:ts|tsx|js|jsx|css)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

const requiredPaths = [
  "AGENTS.md",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/server/src/index.ts",
  "apps/web/index.html",
  "packages/shared/src/index.ts",
  "tests/e2e/lobby.spec.ts",
  "installer/W_SHA.iss",
  "release-template/使用说明.txt",
  "docs/release-acceptance.md",
  "scripts/verify-packaged-ui.cjs",
  "scripts/verify-release-artifacts.cjs"
];
for (const relativePath of requiredPaths) {
  assert(fs.existsSync(resolveProjectPath(relativePath)), `required path is missing: ${relativePath}`);
}

assert(/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager ?? ""), "packageManager must pin a pnpm version");
assert(packageJson.engines?.node === ">=22", "Node.js engine must remain >=22");
for (const script of ["check", "check:all", "security:check", "verify:repo", "verify:package:ui", "verify:release"]) {
  assert(typeof packageJson.scripts?.[script] === "string", `missing package script: ${script}`);
}
assert(Number(process.versions.node.split(".")[0]) >= 22, `Node.js 22 or newer is required (found ${process.version})`);

const gitFiles = spawnSync("git", ["ls-files", "-z"], {
  cwd: projectRoot,
  encoding: "utf8"
});
assert(gitFiles.status === 0, "git ls-files could not inspect the repository");
const trackedFiles = gitFiles.stdout.split("\0").filter(Boolean);
const generatedPattern = /(^|\/)(?:node_modules|dist|coverage|playwright-report|test-results|release|\.runtime)(\/|$)|(^|\/)(?:ai-master-key|\.env)(?:$|\.)/;
const trackedGeneratedFiles = trackedFiles.filter((file) => generatedPattern.test(file) && !file.endsWith(".env.example"));
assert(trackedGeneratedFiles.length === 0, `generated or secret files are tracked: ${trackedGeneratedFiles.join(", ")}`);

const productionRoots = ["apps/server/src", "apps/web/src", "packages/shared/src"].map(resolveProjectPath);
for (const rootPath of productionRoots) {
  for (const filePath of sourceFiles(rootPath)) {
    const content = fs.readFileSync(filePath, "utf8");
    assert(!content.includes("incoming-assets"), `production source references incoming-assets: ${path.relative(projectRoot, filePath)}`);
  }
}

const installerScript = fs.readFileSync(resolveProjectPath("installer/W_SHA.iss"), "utf8");
assert(
  installerScript.includes("profile=any protocol=tcp localport=35173 remoteip=localsubnet"),
  "installer firewall rule must be limited to TCP/35173 on the local subnet across all profiles"
);

const launcherScript = fs.readFileSync(resolveProjectPath("release-template/启动狼人杀.cmd"), "utf8");
assert(launcherScript.includes('set "PORT=35173"') && launcherScript.includes('set "WEB_PORT=35173"'), "release launcher must use TCP/35173");

const lanVerifierScript = fs.readFileSync(resolveProjectPath("scripts/verify-lan-release.cjs"), "utf8");
assert(lanVerifierScript.includes("const DEFAULT_RELEASE_PORT = 35173;"), "LAN release verifier must default to TCP/35173");

const installerPackagingScript = fs.readFileSync(resolveProjectPath("scripts/package-installer.cjs"), "utf8");
assert(installerPackagingScript.includes("verify-release-artifacts.cjs"), "installer packaging must verify final release artifacts");

console.log(`Repository verification passed (${trackedFiles.length} tracked files checked).`);
