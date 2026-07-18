import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";
import { selectLanAddress } from "./network.js";
import { openBrowser } from "./open-browser.js";
import { GameRuntime } from "./runtime.js";
import { attachSocketServer } from "./socket.js";
import { SnapshotStore } from "./snapshot-store.js";

const config = loadConfig();
const localAddress = config.PUBLIC_ADDRESS ?? selectLanAddress();
const snapshotStore = new SnapshotStore(config.DATABASE_PATH);
let snapshot = null;
try {
  snapshot = snapshotStore.load();
} catch (error) {
  snapshotStore.close();
  throw error;
}
const runtime = new GameRuntime(snapshot
  ? { localAddress, webPort: config.WEB_PORT, snapshot }
  : { localAddress, webPort: config.WEB_PORT });
const app = buildServer(config, runtime);
const persistSnapshot = () => snapshotStore.save(runtime.createSnapshot());
const testStageTiming = config.NODE_ENV === "test" ? {
  "role-reveal": { minimumMs: 50, maximumMs: 500 },
  wolf: { minimumMs: 50, maximumMs: 500 },
  seer: { minimumMs: 50, maximumMs: 500 },
  witch: { minimumMs: 50, maximumMs: 500 },
  dawn: { minimumMs: 5_000, maximumMs: 5_000 },
  "last-words": { minimumMs: 50, maximumMs: 500 },
  "day-speech": { minimumMs: 50, maximumMs: 500 },
  "day-vote": { minimumMs: 50, maximumMs: 500 },
  "exile-result": { minimumMs: 50, maximumMs: 500 }
} as const : {};
const io = attachSocketServer(app.server, app.log, runtime, persistSnapshot, true, testStageTiming);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  persistSnapshot();
  io.close();
  await app.close();
  snapshotStore.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  persistSnapshot();
  app.log.info({
    host: config.HOST,
    port: config.PORT,
    joinAddress: runtime.room.getJoinUrl(),
    restored: snapshot !== null
  }, "server ready");
  if (config.OPEN_BROWSER) openBrowser(`http://127.0.0.1:${config.PORT}/`);
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  process.exit(1);
}
