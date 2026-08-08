import { spawnSync } from "node:child_process";

const powershellExecutable = "powershell.exe";

export function protectForCurrentWindowsUser(value: string): string {
  return runDpapi([
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$encoded = [Console]::In.ReadToEnd().Trim()",
    "$data = [Convert]::FromBase64String($encoded)",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($data, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($protected)"
  ].join("; "), value);
}

export function unprotectForCurrentWindowsUser(value: string): string {
  return runDpapi([
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    "$encoded = [Console]::In.ReadToEnd().Trim()",
    "$protected = [Convert]::FromBase64String($encoded)",
    "$data = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($data)"
  ].join("; "), value);
}

function runDpapi(command: string, input: string): string {
  const result = spawnSync(powershellExecutable, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], {
    input,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error("Windows DPAPI operation failed");
  }
  const output = result.stdout.trim();
  if (!output) throw new Error("Windows DPAPI returned an empty value");
  return output;
}
