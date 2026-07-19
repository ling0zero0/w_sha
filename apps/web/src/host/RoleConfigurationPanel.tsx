import { ListOrdered, MessagesSquare, Play } from "lucide-react";
import type {
  ChatMode,
  NormalizedRoleConfiguration,
  Role,
  RoleConfiguration,
  StartReadiness
} from "@werewolf/shared";
import { useEffect, useState } from "react";

const roleFields: Array<{ key: Role; label: string; max?: number }> = [
  { key: "wolf", label: "狼人" },
  { key: "villager", label: "村民" },
  { key: "seer", label: "预言家", max: 1 },
  { key: "witch", label: "女巫", max: 1 },
  { key: "guard", label: "守卫", max: 1 },
  { key: "hunter", label: "猎人", max: 1 },
  { key: "idiot", label: "白痴", max: 1 }
];

function normalizeConfiguration(configuration: RoleConfiguration): NormalizedRoleConfiguration {
  return {
    wolf: configuration.wolf,
    villager: configuration.villager,
    seer: configuration.seer,
    witch: configuration.witch,
    guard: configuration.guard ?? 0,
    hunter: configuration.hunter ?? 0,
    idiot: configuration.idiot ?? 0
  };
}

export function RoleConfigurationPanel({
  configuration,
  chatMode,
  readiness,
  connected,
  onChange,
  onChatModeChange,
  onStart
}: {
  configuration: RoleConfiguration;
  chatMode: ChatMode;
  readiness: StartReadiness;
  connected: boolean;
  onChange: (configuration: RoleConfiguration) => void;
  onChatModeChange: (chatMode: ChatMode) => void;
  onStart: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeConfiguration(configuration));

  useEffect(() => {
    setDraft(normalizeConfiguration(configuration));
  }, [configuration]);

  return (
    <section className="role-configuration" aria-labelledby="role-configuration-title">
      <div className="role-configuration-heading">
        <div>
          <p className="eyebrow">开局准备</p>
          <h2 id="role-configuration-title">身份配置</h2>
        </div>
        <span className={readiness.ready ? "readiness-ready" : "readiness-blocked"} data-testid="start-readiness">
          {readiness.ready ? "配置就绪" : "暂不可开始"}
        </span>
      </div>
      <div className="role-fields">
        {roleFields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              aria-label={`${field.label}数量`}
              type="number"
              min={0}
              max={field.max}
              step={1}
              value={draft[field.key]}
              disabled={!connected}
              onChange={(event) => {
                const value = Math.max(0, Math.trunc(Number(event.target.value) || 0));
                const nextConfiguration = {
                  ...draft,
                  [field.key]: field.max === undefined ? value : Math.min(field.max, value)
                };
                setDraft(nextConfiguration);
                onChange(nextConfiguration);
              }}
            />
          </label>
        ))}
      </div>
      <div className="readiness-summary">
        <span>参赛人数 <strong data-testid="participant-count">{readiness.participantCount}</strong></span>
        <span>身份总数 <strong data-testid="configured-role-count">{readiness.configuredRoleCount}</strong></span>
      </div>
      <div className="chat-mode-setting">
        <div>
          <strong id="chat-mode-label">白天发言模式</strong>
          <small>{connected ? "开局前可调整" : "连接恢复后可调整"}</small>
        </div>
        <div className="chat-mode-segments" role="radiogroup" aria-labelledby="chat-mode-label">
          <button
            type="button"
            role="radio"
            aria-checked={chatMode === "ordered"}
            className={chatMode === "ordered" ? "is-selected" : ""}
            disabled={!connected}
            onClick={() => onChatModeChange("ordered")}
          >
            <ListOrdered size={17} aria-hidden="true" />
            <span>有序发言</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={chatMode === "open"}
            className={chatMode === "open" ? "is-selected" : ""}
            disabled={!connected}
            onClick={() => onChatModeChange("open")}
          >
            <MessagesSquare size={17} aria-hidden="true" />
            <span>自由讨论</span>
          </button>
        </div>
      </div>
      {readiness.issues.length > 0 ? (
        <ul className="readiness-issues" aria-label="开局阻塞原因">
          {readiness.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : (
        <p className="readiness-success">身份数量和最低阵营要求均已满足</p>
      )}
      <button
        className="start-game-button"
        type="button"
        disabled={!connected || !readiness.ready}
        onClick={() => window.confirm("开始后将锁定名单并随机分配身份，确定开始吗？") && onStart()}
      >
        <Play size={17} aria-hidden="true" />开始游戏
      </button>
    </section>
  );
}
