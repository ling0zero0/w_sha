import { buildServer } from "./app.js";
import { ChatStore } from "./chat-store.js";
import { loadConfig } from "./config.js";
import { selectLanAddress } from "./network.js";
import { openBrowser } from "./open-browser.js";
import { GameRuntime } from "./runtime.js";
import { attachSocketServer } from "./socket.js";
import { SnapshotStore } from "./snapshot-store.js";
import { AiAuditStore } from "./ai/ai-audit-store.js";
import { AiConfigStore } from "./ai/ai-config-store.js";
import { loadOrCreateSecretBox } from "./ai/master-key.js";
import { ProviderRegistry } from "./ai/provider-registry.js";
import { createOpenAiCompatibleProvider } from "./ai/providers/openai-compatible.js";
import { ActionLedger } from "./socket/action-ledger.js";

let actionLedger: ActionLedger | undefined;

function closeResources(): void {
  snapshotStore.close();
  chatStore.close();
  aiAuditStore.close();
  aiConfigStore.close();
  actionLedger?.close();
}

const config = loadConfig();
const aiGameTokenBudget = config.AI_GAME_TOKEN_BUDGET ?? 100_000;
const localAddress = config.PUBLIC_ADDRESS ?? selectLanAddress();
const snapshotStore = new SnapshotStore(config.DATABASE_PATH);
const chatStore = new ChatStore(config.DATABASE_PATH);
const secretBox = loadOrCreateSecretBox(config.DATABASE_PATH, config.AI_MASTER_KEY);
const aiConfigStore = new AiConfigStore(config.DATABASE_PATH, secretBox);
const aiAuditStore = new AiAuditStore(config.DATABASE_PATH);
const providerRegistry = new ProviderRegistry();
providerRegistry.register("openai-compatible-chat", createOpenAiCompatibleProvider);
let snapshot = null;
try {
  if (!snapshotStore.checkIntegrity()) throw new Error("runtime database integrity check failed");
  snapshot = snapshotStore.load();
} catch (error) {
  closeResources();
  throw error;
}
const runtime = new GameRuntime(
  snapshot
    ? { localAddress, webPort: config.WEB_PORT, snapshot, chatPersistence: chatStore }
    : { localAddress, webPort: config.WEB_PORT, chatPersistence: chatStore }
);
try {
  actionLedger = new ActionLedger({
    databasePath: config.DATABASE_PATH,
    secretBox
  });
} catch (error) {
  closeResources();
  throw error;
}
const app = buildServer(config, runtime, {
  store: aiConfigStore,
  providers: providerRegistry,
  auditStore: aiAuditStore
});
const persistSnapshot = () => snapshotStore.schedule(runtime.createSnapshot());
const testStageTiming =
  config.NODE_ENV === "test"
    ? ({
        // UI-driven tests need time for real input; completed stages still advance after 50ms.
        "role-reveal": { minimumMs: 50, maximumMs: 30_000 },
        wolf: { minimumMs: 50, maximumMs: 30_000 },
        seer: { minimumMs: 50, maximumMs: 30_000 },
        guard: { minimumMs: 50, maximumMs: 30_000 },
        witch: { minimumMs: 50, maximumMs: 30_000 },
        hunter: { minimumMs: 50, maximumMs: 30_000 },
        dawn: { minimumMs: 5_000, maximumMs: 5_000 },
        "last-words": { minimumMs: 50, maximumMs: 30_000 },
        "day-speech": { minimumMs: 50, maximumMs: 30_000 },
        "day-vote": { minimumMs: 50, maximumMs: 30_000 },
        "exile-result": { minimumMs: 50, maximumMs: 30_000 }
      } as const)
    : {};
const additionalSocketOrigins = config.SOCKET_ALLOWED_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? [];
const io = attachSocketServer({
  server: app.server,
  logger: app.log,
  runtime,
  persistSnapshot,
  automaticPhaseProgression: true,
  stageTimingOverrides: testStageTiming,
  aiServices: {
    store: aiConfigStore,
    providers: providerRegistry,
    auditStore: aiAuditStore,
    gameTokenBudget: aiGameTokenBudget
  },
  additionalSocketOrigins,
  ...(actionLedger ? { actionLedger } : {})
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  persistSnapshot();
  snapshotStore.flush();
  await io.close();
  await app.close();
  closeResources();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  persistSnapshot();
  app.log.info(
    {
      host: config.HOST,
      port: config.PORT,
      joinAddress: runtime.room.getJoinUrl(),
      restored: snapshot !== null
    },
    "server ready"
  );
  if (config.OPEN_BROWSER) openBrowser(`http://127.0.0.1:${config.PORT}/`);
} catch (error) {
  app.log.fatal({ err: error }, "server failed to start");
  closeResources();
  process.exit(1);
}
