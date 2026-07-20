import { Bot, Cpu, LoaderCircle, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { BotProfilePanel } from "./BotProfilePanel";
import { ModelPanel } from "./ModelPanel";
import { ProviderPanel } from "./ProviderPanel";
import { useAiConfiguration } from "./useAiConfiguration";

type AiTab = "providers" | "models" | "profiles";

const tabs = [
  { id: "providers" as const, label: "服务连接", icon: Server },
  { id: "models" as const, label: "模型", icon: Cpu },
  { id: "profiles" as const, label: "机器人档案", icon: Bot }
];

export function AiManagementScreen() {
  const [tab, setTab] = useState<AiTab>("providers");
  const { client, configuration, loadState, loadError, reload } = useAiConfiguration();

  return (
    <main className="ai-shell">
      <header className="ai-topbar">
        <a className="brand" href="/" aria-label="返回主持人大厅">
          <ShieldCheck size={23} aria-hidden="true" />
          <span>局域网狼人杀</span>
        </a>
        <nav className="ai-host-nav" aria-label="主机管理">
          <a href="/">主持人大厅</a>
          <a href="/ai" aria-current="page">AI 玩家</a>
        </nav>
      </header>

      <section className="ai-workspace">
        <header className="ai-page-heading">
          <div>
            <p className="eyebrow">本地主机管理</p>
            <h1>AI 玩家配置</h1>
            <p>管理模型服务、调用参数与机器人行为档案。</p>
          </div>
          <button type="button" className="ai-refresh-button" disabled={loadState === "loading"} onClick={() => void reload()}>
            <RefreshCw className={loadState === "loading" ? "ai-spin" : ""} size={17} aria-hidden="true" />
            刷新
          </button>
        </header>

        <div className="ai-tab-list" role="tablist" aria-label="AI 配置类别">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-selected" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
              <span>
                {id === "providers"
                  ? configuration.providers.length
                  : id === "models"
                    ? configuration.models.length
                    : configuration.botProfiles.length}
              </span>
            </button>
          ))}
        </div>

        {loadState === "loading" ? (
          <div className="ai-load-state" role="status">
            <LoaderCircle className="ai-spin" size={24} aria-hidden="true" />
            正在加载 AI 配置
          </div>
        ) : loadState === "error" ? (
          <div className="ai-load-state is-error" role="alert">
            <strong>无法打开 AI 管理页面</strong>
            <span>{loadError}</span>
            <button type="button" onClick={() => void reload()}>重试</button>
          </div>
        ) : (
          <section className="ai-tab-panel" role="tabpanel">
            {tab === "providers" ? (
              <ProviderPanel providers={configuration.providers} client={client} onChanged={reload} />
            ) : tab === "models" ? (
              <ModelPanel models={configuration.models} providers={configuration.providers} client={client} onChanged={reload} />
            ) : (
              <BotProfilePanel profiles={configuration.botProfiles} models={configuration.models} client={client} onChanged={reload} />
            )}
          </section>
        )}
      </section>
    </main>
  );
}
