import type {
  AiBotProfileId,
  AiBotProfileView,
  AiBotStrategy,
  AiModelProfileView,
  CreateAiBotProfileRequest
} from "@werewolf/shared";
import { Bot, Plus, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AiAdminClient } from "./ai-client";
import { FormStatus } from "./ProviderPanel";

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
          <div><span>{profiles.length}</span><strong>机器人档案</strong></div>
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
            <span><strong>{profile.name}</strong><small>{profile.defaultNickname} · {strategyLabels[profile.strategy]}</small></span>
            <i className={profile.enabled ? "is-enabled" : ""} aria-label={profile.enabled ? "已启用" : "已停用"} />
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
  const [name, setName] = useState(profile?.name ?? defaults.name);
  const [defaultNickname, setDefaultNickname] = useState(profile?.defaultNickname ?? defaults.defaultNickname);
  const [description, setDescription] = useState(profile?.description ?? defaults.description);
  const [personalityPrompt, setPersonalityPrompt] = useState(profile?.personalityPrompt ?? defaults.personalityPrompt);
  const [speakingStyle, setSpeakingStyle] = useState(profile?.speakingStyle ?? defaults.speakingStyle);
  const [strategy, setStrategy] = useState<AiBotStrategy>(profile?.strategy ?? defaults.strategy);
  const [modelProfileId, setModelProfileId] = useState(profile?.modelProfileId ?? models[0]?.id ?? "");
  const [enabled, setEnabled] = useState(profile?.enabled ?? defaults.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const value: CreateAiBotProfileRequest = {
      name,
      defaultNickname,
      description,
      personalityPrompt,
      speakingStyle,
      strategy,
      modelProfileId,
      enabled
    };
    try {
      if (profile) await client.updateBotProfile(profile.id, value);
      else await client.createBotProfile(value);
      setSuccess("机器人档案已保存");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存机器人档案失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!profile || !window.confirm(`删除机器人档案“${profile.name}”？`)) return;
    setSaving(true);
    setError("");
    try {
      await client.deleteBotProfile(profile.id);
      onDeleted();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除机器人档案失败");
      setSaving(false);
    }
  }

  return (
    <form className="ai-editor" onSubmit={save}>
      <header className="ai-editor-heading">
        <div>
          <p className="eyebrow">{profile ? "编辑档案" : "新建档案"}</p>
          <h2>{profile?.name ?? "添加机器人档案"}</h2>
        </div>
        {profile ? (
          <button type="button" className="ai-icon-button ai-delete-button" aria-label="删除机器人档案" title="删除机器人档案" disabled={saving} onClick={() => void remove()}>
            <Trash2 size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {models.length === 0 ? <p className="ai-inline-notice">请先创建模型，再配置机器人档案。</p> : null}
      <div className="ai-form-grid">
        <label>
          <span>档案名称</span>
          <input required maxLength={80} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>默认昵称</span>
          <input required maxLength={12} value={defaultNickname} disabled={saving} onChange={(event) => setDefaultNickname(event.target.value)} />
        </label>
        <label>
          <span>模型</span>
          <select required value={modelProfileId} disabled={saving || models.length === 0} onChange={(event) => setModelProfileId(event.target.value)}>
            <option value="">选择模型</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <fieldset className="ai-strategy-field">
          <legend>策略</legend>
          <div role="radiogroup" aria-label="机器人策略">
            {(Object.keys(strategyLabels) as AiBotStrategy[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={strategy === value}
                className={strategy === value ? "is-selected" : ""}
                disabled={saving}
                onClick={() => setStrategy(value)}
              >
                {strategyLabels[value]}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="ai-full-field">
          <span>简介</span>
          <textarea maxLength={1000} rows={3} value={description} disabled={saving} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="ai-full-field">
          <span>人格提示词</span>
          <textarea required maxLength={12000} rows={7} value={personalityPrompt} disabled={saving} onChange={(event) => setPersonalityPrompt(event.target.value)} />
        </label>
        <label className="ai-full-field">
          <span>发言风格</span>
          <textarea required maxLength={2000} rows={4} value={speakingStyle} disabled={saving} onChange={(event) => setSpeakingStyle(event.target.value)} />
        </label>
      </div>

      <label className="ai-toggle-row">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => setEnabled(event.target.checked)} />
        <span>启用此机器人档案</span>
      </label>
      <FormStatus error={error} success={success} />
      <footer className="ai-form-actions">
        <button type="submit" className="ai-primary-button" disabled={saving || models.length === 0}>
          <Save size={17} aria-hidden="true" />
          {saving ? "正在保存…" : "保存档案"}
        </button>
      </footer>
    </form>
  );
}
