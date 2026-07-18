import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  const command = process.platform === "win32"
    ? { executable: process.env.ComSpec ?? "cmd.exe", arguments: ["/d", "/c", "start", "", url] }
    : process.platform === "darwin"
      ? { executable: "open", arguments: [url] }
      : { executable: "xdg-open", arguments: [url] };
  const child = spawn(command.executable, command.arguments, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.once("error", () => undefined);
  child.unref();
}
