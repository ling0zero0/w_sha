import type { AiBotProfileId, AiBotProfileView, AiBotStrategy, AiModelProfileView, CreateAiBotProfileRequest } from "@werewolf/shared";
import { Bot, Plus, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AiAdminClient } from "./ai-client";
import { FormStatus } from "./FormStatus";
import { useAiForm } from "./useAiForm";

interface BotProfilePanelProps {
  profiles: AiBotProfileView[];
  models: AiModelProfileView[];
  client: AiAdminClient;
  onChanged(): Promise<void>;
}

const defaults = {
  name: "",
  defaultNickname: "",
  description: "",
  personalityPrompt: "",
  speakingStyle: "",
  strategy: "balanced" as const,
  enabled: true
};

const strategyLabels: Record<AiBotStrategy, string> = {
  cautious: "谨慎",
  balanced: "平衡",
  aggressive: "激进"
};

export function BotProfilePanel({ profiles, models, client, onChanged }: BotProfilePanelProps) {
  const [selectedId, setSelectedId] = useState<AiBotProfileId | "new">(profiles[0]?.id ?? "new");
  const selected = profiles.find((profile) => profile.id === selectedId);

  return (
    <div className="ai-resource-layout">
      <aside className="ai-resource-list" aria-label="机器人档案列表">
        <div className="ai-list-heading">
          <div>
            <span>{profiles.length}</span>
            <strong>机器人档案</strong>
          </div>
          <button type="button" className="ai-icon-button" aria-label="新建机器人档案" title="新建机器人档案" onClick={() => setSelectedId("new")}>
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {profiles.map((profile) => (
          <button
            type="button"
            className={`ai-list-item${selectedId === profile.id ? " is-selected" : ""}`}
            key={profile.id}
            onClick={() => setSelectedId(profile.id)}
          >
            <Bot size={18} aria-hidden="true" />
            <span>
              <strong>{profile.name}</strong>
              <small>
                {profile.defaultNickname} · {strategyLabels[profile.strategy]}
              </small>
            </span>
            <i className={profile.enabled ? "is-enabled" : ""} role="img" aria-label={profile.enabled ? "已启用" : "已停用"} />
          </button>
        ))}
        {profiles.length === 0 ? <p className="ai-list-empty">尚未配置机器人档案</p> : null}
      </aside>
      <BotProfileForm
        key={selected?.id ?? "new"}
        {...(selected ? { profile: selected } : {})}
        models={models}
        client={client}
        onChanged={onChanged}
        onDeleted={() => setSelectedId("new")}
      />
    </div>
  );
}

function BotProfileForm({
  profile,
  models,
  client,
  onChanged,
  onDeleted
}: {
  profile?: AiBotProfileView;
  models: AiModelProfileView[];
  client: AiAdminClient;
  onChanged(): Promise<void>;
  onDeleted(): void;
}) {
  const form = useAiForm({
    name: profile?.name ?? defaults.name,
    defaultNickname: profile?.defaultNickname ?? defaults.defaultNickname,
    description: profile?.description ?? defaults.description,
    personalityPrompt: profile?.personalityPrompt ?? defaults.personalityPrompt,
    speakingStyle: profile?.speakingStyle ?? defaults.speakingStyle,
    strategy: profile?.strategy ?? defaults.strategy,
    modelProfileId: profile?.modelProfileId ?? models[0]?.id ?? "",
    enabled: profile?.enabled ?? defaults.enabled
  });
  const { values, saving, status } = form;

  async function save(event: FormEvent) {
    event.preventDefault();
    await form.submit(async () => {
      const value: CreateAiBotProfileRequest = {
        name: values.name,
        defaultNickname: values.defaultNickname,
        description: values.description,
        personalityPrompt: values.personalityPrompt,
        speakingStyle: values.speakingStyle,
        strategy: values.strategy,
        modelProfileId: values.modelProfileId,
        enabled: values.enabled
      };
      if (profile) await client.updateBotProfile(profile.id, value);
      else await client.createBotProfile(value);
      await onChanged();
    }, "机器人档案已保存", "保存机器人档案失败");
  }

  async function remove() {
    if (!profile || !window.confirm(`删除机器人档案“${profile.name}”？`)) return;
    await form.destroy(async () => {
      await client.deleteBotProfile(profile.id);
      onDeleted();
      await onChanged();
    }, "删除机器人档案失败");
  }

  return (
    <form className="ai-editor" onSubmit={save}>
      <header className="ai-editor-heading">
        <div>
          <p className="eyebrow">{profile ? "编辑档案" : "新建档案"}</p>
          <h2>{profile?.name ?? "添加机器人档案"}</h2>
        </div>
        {profile ? (
          <button
            type="button"
            className="ai-icon-button ai-delete-button"
            aria-label="删除机器人档案"
            title="删除机器人档案"
            disabled={saving}
            onClick={() => void remove()}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {models.length === 0 ? <p className="ai-inline-notice">请先创建模型，再配置机器人档案。</p> : null}
      <div className="ai-form-grid">
        <label>
          <span>档案名称</span>
          <input
            required
            maxLength={80}
            value={values.name}
            disabled={saving}
            onChange={(event) => form.setField("name", event.target.value)}
          />
        </label>
        <label>
          <span>默认昵称</span>
          <input
            required
            maxLength={12}
            value={values.defaultNickname}
            disabled={saving}
            onChange={(event) => form.setField("defaultNickname", event.target.value)}
          />
        </label>
        <label>
          <span>模型</span>
          <select
            required
            value={values.modelProfileId}
            disabled={saving || models.length === 0}
            onChange={(event) => form.setField("modelProfileId", event.target.value)}
          >
            <option value="">选择模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="ai-strategy-field">
          <legend>策略</legend>
          <div role="radiogroup" aria-label="机器人策略">
            {(Object.keys(strategyLabels) as AiBotStrategy[]).map((value) => (
              <label key={value} className={values.strategy === value ? "is-selected" : ""}>
                <input
                  type="radio"
                  name="bot-strategy"
                  value={value}
                  checked={values.strategy === value}
                  disabled={saving}
                  onChange={() => form.setField("strategy", value)}
                />
                {strategyLabels[value]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="ai-full-field">
          <span>简介</span>
          <textarea
            maxLength={1000}
            rows={3}
            value={values.description}
            disabled={saving}
            onChange={(event) => form.setField("description", event.target.value)}
          />
        </label>
        <label className="ai-full-field">
          <span>人格提示词</span>
          <textarea
            required
            maxLength={12000}
            rows={7}
            value={values.personalityPrompt}
            disabled={saving}
            onChange={(event) => form.setField("personalityPrompt", event.target.value)}
          />
        </label>
        <label className="ai-full-field">
          <span>发言风格</span>
          <textarea
            required
            maxLength={2000}
            rows={4}
            value={values.speakingStyle}
            disabled={saving}
            onChange={(event) => form.setField("speakingStyle", event.target.value)}
          />
        </label>
      </div>

      <label className="ai-toggle-row">
        <input
          type="checkbox"
          checked={values.enabled}
          disabled={saving}
          onChange={(event) => form.setField("enabled", event.target.checked)}
        />
        <span>启用此机器人档案</span>
      </label>
      <FormStatus status={status} />
      <footer className="ai-form-actions">
        <button type="submit" className="ai-primary-button" disabled={saving || models.length === 0}>
          <Save size={17} aria-hidden="true" />
          {saving ? "正在保存…" : "保存档案"}
        </button>
      </footer>
    </form>
  );
}
