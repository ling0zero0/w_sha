import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";
import { GameRuntime } from "./runtime.js";

const testConfig: ServerConfig = {
  HOST: "127.0.0.1",
  PORT: 3000,
  WEB_PORT: 5173,
  OPEN_BROWSER: false,
  DATABASE_PATH: ":memory:",
  LOG_LEVEL: "silent",
  NODE_ENV: "test"
};

const servers: ReturnType<typeof buildServer>[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("server shell", () => {
  it("returns a validated health payload", async () => {
    const server = buildServer(testConfig);
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "werewolf-lan-server",
      status: "ok"
    });
  });

  it("returns a stable public error shape", async () => {
    const server = buildServer(testConfig);
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("serves production assets and falls back to the SPA entry", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "werewolf-web-"));
    temporaryDirectories.push(webRoot);
    writeFileSync(join(webRoot, "index.html"), '<main id="root"></main>', "utf8");
    writeFileSync(join(webRoot, "app.js"), "window.werewolf = true;", "utf8");
    const server = buildServer({
      ...testConfig,
      WEB_ROOT: webRoot
    });
    servers.push(server);

    const entry = await server.inject({ method: "GET", url: "/join/123456?t=token" });
    const asset = await server.inject({ method: "GET", url: "/app.js" });

    expect(entry.statusCode).toBe(200);
    expect(entry.headers["content-type"]).toContain("text/html");
    expect(entry.body).toContain('id="root"');
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("window.werewolf");
  });

  it("only returns host credentials to the loopback browser surface", async () => {
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      hostSession: "zyxwvutsrqponmlkjihgfedcba654321"
    });
    const server = buildServer(testConfig, runtime);
    servers.push(server);

    const denied = await server.inject({
      method: "GET",
      url: "/api/host-bootstrap",
      headers: { referer: "http://192.168.1.20:5173/" }
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await server.inject({
      method: "GET",
      url: "/api/host-bootstrap",
      headers: { referer: "http://127.0.0.1:5173/" }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["cache-control"]).toBe("no-store");
    expect(allowed.json()).toMatchObject({ sessionToken: runtime.hostSession });
  });

  it("rejects a remote request even when it spoofs a loopback referer", async () => {
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      hostSession: "zyxwvutsrqponmlkjihgfedcba654321"
    });
    const server = buildServer(testConfig, runtime);
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/host-bootstrap",
      remoteAddress: "192.168.1.44",
      headers: { referer: "http://127.0.0.1:5173/" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).not.toHaveProperty("sessionToken");
  });

  it("rejects a remote browser forwarded by the local Vite proxy", async () => {
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      hostSession: "zyxwvutsrqponmlkjihgfedcba654321"
    });
    const server = buildServer(testConfig, runtime);
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/host-bootstrap",
      remoteAddress: "127.0.0.1",
      headers: {
        referer: "http://127.0.0.1:5173/",
        "x-werewolf-proxy-client-ip": "192.168.1.44"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).not.toHaveProperty("sessionToken");
  });

  it.each(["file://127.0.0.1/", "ftp://127.0.0.1/"])(
    "rejects a non-HTTP loopback source: %s",
    async (source) => {
      const runtime = new GameRuntime({
        localAddress: "192.168.1.20",
        webPort: 5173,
        roomCode: "123456",
        joinToken: "abcdefghijklmnopqrstuvwxyz123456",
        hostSession: "zyxwvutsrqponmlkjihgfedcba654321"
      });
      const server = buildServer(testConfig, runtime);
      servers.push(server);

      const response = await server.inject({
        method: "GET",
        url: "/api/host-bootstrap",
        headers: { referer: source }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).not.toHaveProperty("sessionToken");
    }
  );

  it("allows a loopback browser forwarded by the local Vite proxy", async () => {
    const runtime = new GameRuntime({
      localAddress: "192.168.1.20",
      webPort: 5173,
      roomCode: "123456",
      joinToken: "abcdefghijklmnopqrstuvwxyz123456",
      hostSession: "zyxwvutsrqponmlkjihgfedcba654321"
    });
    const server = buildServer(testConfig, runtime);
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/api/host-bootstrap",
      remoteAddress: "127.0.0.1",
      headers: {
        referer: "http://127.0.0.1:5173/",
        "x-werewolf-proxy-client-ip": "::ffff:127.0.0.1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ sessionToken: runtime.hostSession });
  });
});
