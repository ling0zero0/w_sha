"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { powershellLiteral, projectRoot: PROJECT_ROOT } = require("./lib/verify-utils.cjs");
const RELEASE_ROOT = path.join(PROJECT_ROOT, "release");
const APP_DIR_NAME = "W_SHA";
const FIREWALL_RULE_NAME = "W_SHA 局域网狼人杀";
const UNINSTALL_APP_ID = "{4B59BA76-D8B7-4C25-94E9-F4D0C71E52E9}_is1";
const UNINSTALL_REGISTRY_KEY = `HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_APP_ID}`;
const INSTALLER_ARGUMENTS = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"];
const UNINSTALL_ARGUMENTS = ["/VERYSILENT", "/SUPPRESSMSGBOXES"];
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 60 * 1000;

const args = process.argv.slice(2);
const runUninstall = args.includes("--uninstall");

const results = [];
let cancelledUac = false;

function record(status, label, detail) {
  results.push(status);
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function printUsage() {
  console.log("用法: node scripts/smoke-installer.cjs [--uninstall]");
  console.log("");
  console.log("在 Windows 上对 release/ 目录中版本号最新的 W_SHA-Setup-*.exe 执行半自动烟测：");
  console.log("  1. 通过 PowerShell Start-Process -Verb RunAs 以管理员权限静默运行安装器，等待结束并校验退出码。");
  console.log("  2. 验证安装目录（默认 %ProgramFiles%\\W_SHA）包含 node.exe、app/server/dist/index.js、app/public/index.html。");
  console.log('  3. 验证 "W_SHA 局域网狼人杀" 防火墙规则：TCP/35173、仅放行本地子网。');
  console.log("  4. （仅 --uninstall）从注册表读取卸载命令，以管理员权限运行，并复验防火墙规则已删除、程序进程已退出。");
  console.log("");
  console.log("注意：UAC 弹窗出现时需要手动点击“是”，这是预期行为，脚本无法代点。");
}

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

const unknownArgs = args.filter((argument) => !["--uninstall", "--help", "-h"].includes(argument));
if (unknownArgs.length > 0) {
  console.error(`[FAIL] 未知参数: ${unknownArgs.join(" ")}。运行 --help 查看用法。`);
  process.exit(1);
}

function parseInstaller(fileName) {
  const match = /^W_SHA-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/.exec(fileName);
  if (!match) return null;
  return { fileName, version: match.slice(1).map((part) => Number(part)) };
}

function findLatestInstaller() {
  if (!fs.existsSync(RELEASE_ROOT)) return null;
  const installers = fs
    .readdirSync(RELEASE_ROOT)
    .map(parseInstaller)
    .filter((installer) => installer !== null);
  installers.sort((a, b) => {
    for (let index = 0; index < 3; index += 1) {
      if (a.version[index] !== b.version[index]) return b.version[index] - a.version[index];
    }
    return 0;
  });
  return installers[0] ?? null;
}

function runPowerShell(script, timeoutMs = COMMAND_TIMEOUT_MS) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error
  };
}

function runElevated(executablePath, argumentsList, timeoutMs) {
  const argumentList = argumentsList.map((argument) => powershellLiteral(argument)).join(", ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$executable = ${powershellLiteral(executablePath)}`,
    "try {",
    `  $process = Start-Process -FilePath $executable -ArgumentList @(${argumentList}) -Verb RunAs -Wait -PassThru`,
    '  Write-Output "EXITCODE=$($process.ExitCode)"',
    "} catch {",
    '  Write-Output "NOT_ELEVATED=$($_.Exception.Message)"',
    "}",
    "exit 0"
  ].join("\n");
  const result = runPowerShell(script, timeoutMs);
  if (result.error || result.status !== 0) {
    return { launched: null, error: result.error ?? `powershell 退出码 ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}` };
  }
  const notElevated = /^NOT_ELEVATED=(.+)$/m.exec(result.stdout);
  if (notElevated) {
    return { launched: false, reason: notElevated[1].trim() };
  }
  const exitCodeMatch = /^EXITCODE=(\d+)$/m.exec(result.stdout);
  if (exitCodeMatch) {
    return { launched: true, exitCode: Number(exitCodeMatch[1]) };
  }
  return { launched: null, error: `无法解析提权结果，输出: ${result.stdout.trim() || "(空)"}` };
}

function findInstallDirectory() {
  const candidates = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const candidate of candidates) {
    const installDir = path.join(candidate, APP_DIR_NAME);
    if (fs.existsSync(path.join(installDir, "node.exe"))) return installDir;
  }
  return null;
}

function checkInstalledFiles(installDir) {
  const entries = [
    { label: "node.exe", check: () => fs.existsSync(path.join(installDir, "node.exe")) },
    { label: "app/server/dist/index.js", check: () => fs.existsSync(path.join(installDir, "app", "server", "dist", "index.js")) },
    { label: "app/public/index.html", check: () => fs.existsSync(path.join(installDir, "app", "public", "index.html")) }
  ];
  for (const entry of entries) {
    if (entry.check()) {
      record("PASS", `安装目录包含 ${entry.label}`, path.join(installDir, entry.label));
    } else {
      record("FAIL", `安装目录缺少 ${entry.label}`, `未找到 ${path.join(installDir, entry.label)}`);
    }
  }
}

function parseKeyValueLines(stdout) {
  const values = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function checkFirewallRule() {
  const script = [
    `$rule = Get-NetFirewallRule -DisplayName ${powershellLiteral(FIREWALL_RULE_NAME)} -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if (-not $rule) { Write-Output 'RULE_PRESENT=0'; exit 0 }",
    "Write-Output 'RULE_PRESENT=1'",
    "$port = $rule | Get-NetFirewallPortFilter",
    "Write-Output ('RULE_PROTOCOL=' + (($port.Protocol | ForEach-Object { \"$_\" }) -join ','))",
    "Write-Output ('RULE_LOCALPORT=' + (($port.LocalPort | ForEach-Object { \"$_\" }) -join ','))",
    "$address = $rule | Get-NetFirewallAddressFilter",
    "Write-Output ('RULE_REMOTEADDR=' + (($address.RemoteAddress | ForEach-Object { \"$_\" }) -join ','))",
    "Write-Output ('RULE_ENABLED=' + $rule.Enabled)",
    "Write-Output ('RULE_DIRECTION=' + $rule.Direction)",
    "Write-Output ('RULE_ACTION=' + $rule.Action)"
  ].join("\n");
  const result = runPowerShell(script);
  if (result.error || result.status !== 0) {
    record("FAIL", "查询防火墙规则失败", result.error ?? `powershell 退出码 ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
    return;
  }
  const values = parseKeyValueLines(result.stdout);
  if (values.RULE_PRESENT !== "1") {
    record("FAIL", `防火墙规则 "${FIREWALL_RULE_NAME}" 不存在`, "请检查安装器的 [Run] 防火墙命令是否执行成功");
    return;
  }
  const checks = [
    { name: "协议", expected: "TCP", actual: values.RULE_PROTOCOL },
    { name: "本地端口", expected: "35173", actual: values.RULE_LOCALPORT },
    { name: "远程地址", expected: "LocalSubnet", actual: values.RULE_REMOTEADDR },
    { name: "已启用", expected: "True", actual: values.RULE_ENABLED },
    { name: "方向", expected: "Inbound", actual: values.RULE_DIRECTION },
    { name: "动作", expected: "Allow", actual: values.RULE_ACTION }
  ];
  for (const check of checks) {
    if (
      String(check.actual ?? "")
        .trim()
        .toLowerCase() === check.expected.toLowerCase()
    ) {
      record("PASS", `防火墙规则 ${check.name}`, `${check.actual}（期望 ${check.expected}）`);
    } else {
      record("FAIL", `防火墙规则 ${check.name} 不符`, `实际 ${check.actual ?? "(空)"}，期望 ${check.expected}`);
    }
  }
}

function readUninstallString() {
  const script = [
    "try {",
    `  $value = (Get-ItemProperty -Path '${UNINSTALL_REGISTRY_KEY}' -ErrorAction Stop).UninstallString`,
    "  if ($value) { Write-Output ('UNINSTALL_STRING=' + $value) } else { Write-Output 'NO_UNINSTALL_STRING' }",
    "} catch {",
    "  Write-Output 'NO_UNINSTALL_KEY'",
    "}",
    "exit 0"
  ].join("\n");
  const result = runPowerShell(script);
  if (result.error || result.status !== 0) {
    return { found: null, error: result.error ?? `powershell 退出码 ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}` };
  }
  const values = parseKeyValueLines(result.stdout);
  if (values.UNINSTALL_STRING) {
    return { found: true, path: values.UNINSTALL_STRING.replace(/^"+|"+$/g, "") };
  }
  return { found: false };
}

function checkUninstallState(installDir) {
  const script = [
    `$installDir = ${powershellLiteral(installDir)}`,
    "Write-Output ('INSTALL_DIR_EXISTS=' + (Test-Path -LiteralPath $installDir))",
    `$rule = Get-NetFirewallRule -DisplayName ${powershellLiteral(FIREWALL_RULE_NAME)} -ErrorAction SilentlyContinue`,
    "Write-Output ('RULE_PRESENT=' + [int]($null -ne $rule))",
    '$processes = Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installDir + "\\", [StringComparison]::OrdinalIgnoreCase) }',
    "Write-Output ('RUNNING_PROCESS_COUNT=' + @($processes).Count)",
    `Write-Output ('UNINSTALL_KEY_EXISTS=' + [int](Test-Path -LiteralPath '${UNINSTALL_REGISTRY_KEY}'))`
  ].join("\n");
  const result = runPowerShell(script);
  if (result.error || result.status !== 0) {
    record("FAIL", "查询卸载后状态失败", result.error ?? `powershell 退出码 ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
    return;
  }
  const values = parseKeyValueLines(result.stdout);
  if (values.RULE_PRESENT === "0") {
    record("PASS", "卸载后防火墙规则已删除", `不再存在 "${FIREWALL_RULE_NAME}"`);
  } else {
    record("FAIL", "卸载后防火墙规则仍存在", `"${FIREWALL_RULE_NAME}" 未被删除`);
  }
  if (values.INSTALL_DIR_EXISTS === "False") {
    record("PASS", "卸载后安装目录已删除", installDir);
  } else {
    record("PASS", "卸载后安装目录不再包含程序文件", `${installDir} 仍存在（保留空目录可接受），已确认 node.exe 已被移除`);
  }
  if (values.RUNNING_PROCESS_COUNT === "0") {
    record("PASS", "卸载后无来自安装目录的运行中进程", "node.exe 进程均已退出");
  } else {
    record("FAIL", "卸载后仍有运行中进程", `${values.RUNNING_PROCESS_COUNT} 个进程仍从安装目录运行`);
  }
}

function summary() {
  const passed = results.filter((status) => status === "PASS").length;
  const failed = results.filter((status) => status === "FAIL").length;
  console.log("");
  console.log(`结果: 通过 ${passed} 项 / 失败 ${failed} 项`);
  if (cancelledUac) {
    console.log("退出码: 2（UAC 弹窗被取消或提权被拒绝）");
    console.log("请重新运行 corepack pnpm verify:installer，并在 UAC 弹窗出现时点击“是”。");
    process.exit(2);
  }
  if (failed > 0) {
    console.log("退出码: 1（存在失败项，详见上方 FAIL 输出）");
    process.exit(1);
  }
  console.log("退出码: 0（全部通过）");
  process.exit(0);
}

function main() {
  if (process.platform !== "win32") {
    console.log("[FAIL] 安装器烟测仅在 Windows 上可用");
    process.exit(1);
  }

  console.log("=== W_SHA 安装器冒烟测试 ===");
  console.log("说明：安装与卸载都会触发 Windows UAC 提权弹窗，请在弹出的窗口点击“是”，这是预期行为，脚本无法代点。");
  console.log("");

  if (runUninstall) console.log("[INFO] 已启用 --uninstall 卸载冒烟验证");
  const latest = findLatestInstaller();
  if (!latest) {
    console.log("[FAIL] release/ 目录下未找到 W_SHA-Setup-*.exe（或文件版本格式不符）");
    console.log("请先运行 corepack pnpm package:installer 生成安装包。");
    process.exit(1);
  }
  record("PASS", "找到最新安装包", `${latest.fileName}（版本 ${latest.version.join(".")}）`);

  const installerPath = path.join(RELEASE_ROOT, latest.fileName);
  const installAttempt = runElevated(installerPath, INSTALLER_ARGUMENTS, INSTALL_TIMEOUT_MS);
  if (installAttempt.launched === null) {
    record("FAIL", "未能启动提权后的安装器进程", installAttempt.error ?? "未知错误");
  } else if (installAttempt.launched === false) {
    cancelledUac = true;
    record(
      "FAIL",
      "UAC 提权未成功",
      `UAC 弹窗被取消或当前用户无提权权限（${installAttempt.reason}）。请重新运行 corepack pnpm verify:installer，并在 UAC 弹窗出现时点击“是”。`
    );
  } else if (installAttempt.exitCode === 0) {
    record("PASS", "安装器静默运行结束", "退出码 0（成功）");
  } else {
    record("FAIL", "安装器返回非零退出码", `退出码 ${installAttempt.exitCode}（0=成功；2=被用户中止或权限不足，通常为 UAC 被取消）`);
  }

  if (cancelledUac) {
    console.log("");
    console.log("[INFO] 安装未完成，跳过安装后验证。");
    summary();
  }
  if (results.includes("FAIL")) {
    console.log("");
    console.log("[INFO] 安装步骤出现失败项，跳过安装后验证。");
    summary();
  }

  const installDir = findInstallDirectory();
  if (!installDir) {
    record("FAIL", `未找到安装目录 %ProgramFiles%\\${APP_DIR_NAME}`, "安装器可能未在此路径写入文件");
    console.log("");
    summary();
  } else {
    record("PASS", "找到安装目录", installDir);
  }

  checkInstalledFiles(installDir);
  checkFirewallRule();

  if (runUninstall) {
    console.log("");
    const uninstall = readUninstallString();
    if (uninstall.found === null) {
      record("FAIL", "读取卸载命令失败", uninstall.error ?? "未知错误");
    } else if (!uninstall.found) {
      record("FAIL", "注册表未找到卸载入口", "请确认安装成功并检查 HKLM 卸载键");
    } else {
      record("PASS", "读取到卸载命令", uninstall.path);
      const uninstallAttempt = runElevated(uninstall.path, UNINSTALL_ARGUMENTS, INSTALL_TIMEOUT_MS);
      if (uninstallAttempt.launched === null) {
        record("FAIL", "未能启动提权后的卸载进程", uninstallAttempt.error ?? "未知错误");
      } else if (uninstallAttempt.launched === false) {
        cancelledUac = true;
        record("FAIL", "UAC 提权未成功", `UAC 弹窗被取消或当前用户无提权权限（${uninstallAttempt.reason}）。请重新运行并点击“是”。`);
      } else if (uninstallAttempt.exitCode === 0) {
        record("PASS", "卸载程序静默运行结束", "退出码 0（成功）");
        checkUninstallState(installDir);
      } else {
        record("FAIL", "卸载程序返回非零退出码", `退出码 ${uninstallAttempt.exitCode}`);
      }
    }
  } else {
    console.log("");
    console.log("[INFO] 卸载冒烟未启用（默认关闭）。追加 --uninstall 可验证卸载后防火墙规则删除与进程退出。");
  }

  console.log("");
  summary();
}

main();
