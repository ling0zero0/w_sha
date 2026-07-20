import { buildServer } from "./app.js";
import { ChatStore } from "./chat-store.js";
import { loadConfig } from "./config.js";
import { selectLanAddress } from "./network.js";
import { openBrowser } from "./open-browser.js";
import { GameRuntime } from "./runtime.js";
import { attachSocketServer } from "./socket.js";
import { SnapshotStore } from "./snapshot-store.js";
import { AiConfigStore } from "./ai/ai-config-store.js";
import { loadOrCreateSecretBox } from "./ai/master-key.js";
import { ProviderRegistry } from "./ai/provider-registry.js";
import { createOpenAiCompatibleProvider } from "./ai/providers/openai-compatible.js";

const config = loadConfig();
const localAddress = config.PUBLIC_ADDRESS ?? selectLanAddress();
const snapshotStore = new SnapshotStore(config.DATABASE_PATH);
const chatStore = new ChatStore(config.DATABASE_PATH);
const secretBox = loadOrCreateSecretBox(config.DATABASE_PATH, config.AI_MASTER_KEY);
const aiConfigStore = new AiConfigStore(config.DATABASE_PATH, secretBox);
const providerRegistry = new ProviderRegistry();
providerRegistry.register("openai-compatible-chat", createOpenAiCompatibleProvider);
let snapshot = null;
try {
  snapshot = snapshotStore.load();
} catch (error) {
  snapshotStore.close();
  chatStore.close();
  throw error;
}
const runtime = new GameRuntime(snapshot
  ? { localAddress, webPort: config.WEB_PORT, snapshot, chatPersistence: chatStore }
  : { localAddress, webPort: config.WEB_PORT, chatPersistence: chatStore });
const app = buildServer(config, runtime, {
  store: aiConfigStore,
  providers: providerRegistry
});
const persistSnapshot = () => snapshotStore.save(runtime.createSnapshot());
const testStageTiming = config.NODE_ENV === "test" ? {
  "role-reveal": { minimumMs: 50, maximumMs: 500 },
  wolf: { minimumMs: 50, maximumMs: 500 },
  seer: { minimumMs: 50, maximumMs: 500 },
  guard: { minimumMs: 50, maximumMs: 500 },
  witch: { minimumMs: 50, maximumMs: 500 },
  hunter: { minimumMs: 50, maximumMs: 500 },
  dawn: { minimumMs: 5_000, maximumMs: 5_000 },
  "last-words": { minimumMs: 50, maximumMs: 500 },
  "day-speech": { minimumMs: 50, maximumMs: 500 },
  "day-vote": { minimumMs: 50, maximumMs: 500 },
  "exile-result": { minimumMs: 50, maximumMs: 500 }
} as const : {};
const io = attachSocketServer(
  app.server,
  app.log,
  runtime,
  persistSnapshot,
  true,
  testStageTiming,
  { store: aiConfigStore, providers: providerRegistry }
);

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  persistSnapshot();
  io.close();
  await app.close();
  snapshotStore.close();
  chatStore.close();
  aiConfigStore.close();
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
  snapshotStore.close();
  chatStore.close();
  aiConfigStore.close();
  process.exit(1);
}
