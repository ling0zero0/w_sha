import type {
  AiModelProfileId,
  AiModelProfileView,
  AiProviderView,
  CreateAiModelProfileRequest
} from "@werewolf/shared";
import { Cpu, FlaskConical, Plus, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AiAdminClient } from "./ai-client";
import { FormStatus } from "./ProviderPanel";

interface ModelPanelProps {
  models: AiModelProfileView[];
  providers: AiProviderView[];
  client: AiAdminClient;
  onChanged(): Promise<void>;
}

const defaults = {
  name: "",
  model: "",
  enabled: true,
  temperature: 0.4,
  maxOutputTokens: 1024,
  requestTimeoutMs: 20000,
  maxAttemptsPerTurn: 2,
  gameTokenBudget: 20000,
  fallbackModelProfileId: null
} satisfies Omit<CreateAiModelProfileRequest, "providerId">;

export function ModelPanel({ models, providers, client, onChanged }: ModelPanelProps) {
  const [selectedId, setSelectedId] = useState<AiModelProfileId | "new">(models[0]?.id ?? "new");
  const selected = models.find((model) => model.id === selectedId);

  return (
    <div className="ai-resource-layout">
      <aside className="ai-resource-list" aria-label="模型列表">
        <div className="ai-list-heading">
          <div><span>{models.length}</span><strong>模型</strong></div>
          <button type="button" className="ai-icon-button" aria-label="新建模型" title="新建模型" onClick={() => setSelectedId("new")}>
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {models.map((model) => (
          <button
            type="button"
            className={`ai-list-item${selectedId === model.id ? " is-selected" : ""}`}
            key={model.id}
            onClick={() => setSelectedId(model.id)}
          >
            <Cpu size={18} aria-hidden="true" />
            <span><strong>{model.name}</strong><small>{model.model}</small></span>
            <i className={model.enabled ? "is-enabled" : ""} aria-label={model.enabled ? "已启用" : "已停用"} />
          </button>
        ))}
        {models.length === 0 ? <p className="ai-list-empty">尚未配置模型</p> : null}
      </aside>
      <ModelForm
        key={selected?.id ?? "new"}
        {...(selected ? { model: selected } : {})}
        models={models}
        providers={providers}
        client={client}
        onChanged={onChanged}
        onDeleted={() => setSelectedId("new")}
      />
    </div>
  );
}

function ModelForm({
  model,
  models,
  providers,
  client,
  onChanged,
  onDeleted
}: {
  model?: AiModelProfileView;
  models: AiModelProfileView[];
  providers: AiProviderView[];
  client: AiAdminClient;
  onChanged(): Promise<void>;
  onDeleted(): void;
}) {
  const [providerId, setProviderId] = useState(model?.providerId ?? providers[0]?.id ?? "");
  const [name, setName] = useState(model?.name ?? defaults.name);
  const [modelName, setModelName] = useState(model?.model ?? defaults.model);
  const [enabled, setEnabled] = useState(model?.enabled ?? defaults.enabled);
  const [temperature, setTemperature] = useState<number | null>(model?.temperature ?? defaults.temperature);
  const [maxOutputTokens, setMaxOutputTokens] = useState(model?.maxOutputTokens ?? defaults.maxOutputTokens);
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(model?.requestTimeoutMs ?? defaults.requestTimeoutMs);
  const [maxAttemptsPerTurn, setMaxAttemptsPerTurn] = useState(model?.maxAttemptsPerTurn ?? defaults.maxAttemptsPerTurn);
  const [gameTokenBudget, setGameTokenBudget] = useState(model?.gameTokenBudget ?? defaults.gameTokenBudget);
  const [fallbackModelProfileId, setFallbackModelProfileId] = useState<string>(model?.fallbackModelProfileId ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const value: CreateAiModelProfileRequest = {
      providerId,
      name,
      model: modelName,
      enabled,
      temperature,
      maxOutputTokens,
      requestTimeoutMs,
      maxAttemptsPerTurn,
      gameTokenBudget,
      fallbackModelProfileId: fallbackModelProfileId || null
    };
    try {
      if (model) await client.updateModel(model.id, value);
      else await client.createModel(value);
      setSuccess("模型配置已保存");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存模型失败");
    } finally {
      setSaving(false);
    }
  }

  async function testModel() {
    if (!model) return;
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      await client.testModel(model.id);
      setSuccess("模型测试通过");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "模型测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!model || !window.confirm(`删除模型“${model.name}”？`)) return;
    setSaving(true);
    setError("");
    try {
      await client.deleteModel(model.id);
      onDeleted();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除模型失败");
      setSaving(false);
    }
  }

  return (
    <form className="ai-editor" onSubmit={save}>
      <header className="ai-editor-heading">
        <div>
          <p className="eyebrow">{model ? "编辑模型" : "新建模型"}</p>
          <h2>{model?.name ?? "添加模型配置"}</h2>
        </div>
        {model ? (
          <button type="button" className="ai-icon-button ai-delete-button" aria-label="删除模型" title="删除模型" disabled={saving || testing} onClick={() => void remove()}>
            <Trash2 size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {providers.length === 0 ? <p className="ai-inline-notice">请先创建服务连接，再配置模型。</p> : null}
      <div className="ai-form-grid">
        <label>
          <span>名称</span>
          <input required maxLength={80} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>服务连接</span>
          <select required value={providerId} disabled={saving || providers.length === 0} onChange={(event) => setProviderId(event.target.value)}>
            <option value="">选择服务连接</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </label>
        <label className="ai-full-field">
          <span>模型 ID</span>
          <input required maxLength={200} value={modelName} disabled={saving} onChange={(event) => setModelName(event.target.value)} />
        </label>
        <label>
          <span>温度</span>
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={temperature ?? ""}
            disabled={saving}
            placeholder="使用服务默认值"
            onChange={(event) => setTemperature(event.target.value === "" ? null : Number(event.target.value))}
          />
        </label>
        <label>
          <span>单次最大输出 Token</span>
          <input type="number" min="1" max="1000000" value={maxOutputTokens} disabled={saving} onChange={(event) => setMaxOutputTokens(Number(event.target.value))} />
        </label>
        <label>
          <span>请求超时（毫秒）</span>
          <input type="number" min="1000" max="300000" step="1000" value={requestTimeoutMs} disabled={saving} onChange={(event) => setRequestTimeoutMs(Number(event.target.value))} />
        </label>
        <label>
          <span>每回合最大尝试</span>
          <input type="number" min="1" max="2" value={maxAttemptsPerTurn} disabled={saving} onChange={(event) => setMaxAttemptsPerTurn(Number(event.target.value))} />
        </label>
        <label>
          <span>单局 Token 预算</span>
          <input type="number" min="1" max="100000000" value={gameTokenBudget} disabled={saving} onChange={(event) => setGameTokenBudget(Number(event.target.value))} />
        </label>
        <label>
          <span>回退模型</span>
          <select value={fallbackModelProfileId} disabled={saving} onChange={(event) => setFallbackModelProfileId(event.target.value)}>
            <option value="">无回退模型</option>
            {models.filter((candidate) => candidate.id !== model?.id).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="ai-toggle-row">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => setEnabled(event.target.checked)} />
        <span>启用此模型</span>
      </label>
      <FormStatus error={error} success={success} />
      <footer className="ai-form-actions">
        {model ? (
          <button type="button" className="ai-secondary-button" disabled={saving || testing} onClick={() => void testModel()}>
            <FlaskConical size={17} aria-hidden="true" />
            {testing ? "正在测试…" : "测试模型"}
          </button>
        ) : null}
        <button type="submit" className="ai-primary-button" disabled={saving || testing || providers.length === 0}>
          <Save size={17} aria-hidden="true" />
          {saving ? "正在保存…" : "保存模型"}
        </button>
      </footer>
    </form>
  );
}
