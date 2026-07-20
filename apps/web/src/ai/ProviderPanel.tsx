import type {
  AiProviderId,
  AiProviderView,
  CreateAiProviderRequest
} from "@werewolf/shared";
import { Check, FlaskConical, Plus, Save, Server, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AiAdminClient } from "./ai-client";
import { CredentialInput } from "./CredentialInput";

interface ProviderPanelProps {
  providers: AiProviderView[];
  client: AiAdminClient;
  onChanged(): Promise<void>;
}

const emptyProvider: CreateAiProviderRequest = {
  name: "",
  protocol: "openai-compatible-chat",
  baseUrl: "",
  enabled: true
};

export function ProviderPanel({ providers, client, onChanged }: ProviderPanelProps) {
  const [selectedId, setSelectedId] = useState<AiProviderId | "new">(
    providers[0]?.id ?? "new"
  );
  const selected = providers.find((provider) => provider.id === selectedId);

  return (
    <div className="ai-resource-layout">
      <aside className="ai-resource-list" aria-label="服务连接列表">
        <div className="ai-list-heading">
          <div>
            <span>{providers.length}</span>
            <strong>服务连接</strong>
          </div>
          <button
            type="button"
            className="ai-icon-button"
            aria-label="新建服务连接"
            title="新建服务连接"
            onClick={() => setSelectedId("new")}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
        {providers.map((provider) => (
          <button
            type="button"
            className={`ai-list-item${selectedId === provider.id ? " is-selected" : ""}`}
            key={provider.id}
            onClick={() => setSelectedId(provider.id)}
          >
            <Server size={18} aria-hidden="true" />
            <span>
              <strong>{provider.name}</strong>
              <small>{provider.baseUrl}</small>
            </span>
            <i className={provider.enabled ? "is-enabled" : ""} aria-label={provider.enabled ? "已启用" : "已停用"} />
          </button>
        ))}
        {providers.length === 0 ? <p className="ai-list-empty">尚未配置服务连接</p> : null}
      </aside>
      <ProviderForm
        key={selected?.id ?? "new"}
        {...(selected ? { provider: selected } : {})}
        client={client}
        onChanged={onChanged}
        onDeleted={() => setSelectedId("new")}
      />
    </div>
  );
}

function ProviderForm({
  provider,
  client,
  onChanged,
  onDeleted
}: {
  provider?: AiProviderView;
  client: AiAdminClient;
  onChanged(): Promise<void>;
  onDeleted(): void;
}) {
  const [name, setName] = useState(provider?.name ?? emptyProvider.name);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? emptyProvider.baseUrl);
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [apiKey, setApiKey] = useState("");
  const [clearCredential, setClearCredential] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    const submittedKey = apiKey || undefined;
    setApiKey("");
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (provider) {
        await client.updateProvider(provider.id, {
          name,
          protocol: "openai-compatible-chat",
          baseUrl,
          enabled,
          ...(submittedKey ? { apiKey: submittedKey } : {}),
          ...(!submittedKey && clearCredential ? { clearCredential: true as const } : {})
        });
      } else {
        await client.createProvider({
          name,
          protocol: "openai-compatible-chat",
          baseUrl,
          enabled,
          ...(submittedKey ? { apiKey: submittedKey } : {})
        });
      }
      setClearCredential(false);
      setSuccess("服务连接已保存");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存服务连接失败");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!provider) return;
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      await client.testProvider(provider.id);
      setSuccess("连接测试通过");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    if (!provider || !window.confirm(`删除服务连接“${provider.name}”？`)) return;
    setSaving(true);
    setError("");
    try {
      await client.deleteProvider(provider.id);
      onDeleted();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除服务连接失败");
      setSaving(false);
    }
  }

  return (
    <form className="ai-editor" onSubmit={save}>
      <header className="ai-editor-heading">
        <div>
          <p className="eyebrow">{provider ? "编辑连接" : "新建连接"}</p>
          <h2>{provider?.name ?? "添加模型服务"}</h2>
        </div>
        {provider ? (
          <button
            type="button"
            className="ai-icon-button ai-delete-button"
            aria-label="删除服务连接"
            title="删除服务连接"
            disabled={saving || testing}
            onClick={() => void remove()}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="ai-form-grid">
        <label>
          <span>名称</span>
          <input required maxLength={80} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>协议</span>
          <select value="openai-compatible-chat" disabled>
            <option value="openai-compatible-chat">OpenAI Compatible Chat</option>
          </select>
        </label>
        <label className="ai-full-field">
          <span>服务地址</span>
          <input
            required
            type="url"
            placeholder="http://127.0.0.1:11434/v1"
            value={baseUrl}
            disabled={saving}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <CredentialInput
          value={apiKey}
          configured={provider?.credentialConfigured ?? false}
          hint={provider?.credentialHint ?? null}
          disabled={saving}
          clearRequested={clearCredential}
          onChange={setApiKey}
          onClearRequested={setClearCredential}
        />
      </div>

      <label className="ai-toggle-row">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={(event) => setEnabled(event.target.checked)} />
        <span>启用此服务连接</span>
      </label>

      <FormStatus error={error} success={success} />
      <footer className="ai-form-actions">
        {provider ? (
          <button type="button" className="ai-secondary-button" disabled={saving || testing} onClick={() => void testConnection()}>
            <FlaskConical size={17} aria-hidden="true" />
            {testing ? "正在测试…" : "测试连接"}
          </button>
        ) : null}
        <button type="submit" className="ai-primary-button" disabled={saving || testing}>
          <Save size={17} aria-hidden="true" />
          {saving ? "正在保存…" : "保存连接"}
        </button>
      </footer>
    </form>
  );
}

export function FormStatus({ error, success }: { error: string; success: string }) {
  if (!error && !success) return null;
  return (
    <p className={`ai-form-status${error ? " is-error" : " is-success"}`} role={error ? "alert" : "status"}>
      {success ? <Check size={16} aria-hidden="true" /> : null}
      {error || success}
    </p>
  );
}
