import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import type { ServerConfig } from "./config.js";

const testConfig: ServerConfig = {
  HOST: "127.0.0.1",
  PORT: 3000,
  LOG_LEVEL: "silent",
  NODE_ENV: "test"
};

const servers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
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
});
