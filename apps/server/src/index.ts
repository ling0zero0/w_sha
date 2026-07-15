import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";
import { attachSocketServer } from "./socket.js";

const config = loadConfig();
const app = buildServer(config);
const io = attachSocketServer(app.server, app.log);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  io.close();
  await app.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ host: config.HOST, port: config.PORT }, "server ready");
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  process.exit(1);
}

