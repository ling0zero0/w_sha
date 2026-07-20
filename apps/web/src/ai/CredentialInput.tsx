import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { useState } from "react";

export interface CredentialInputProps {
  value: string;
  configured: boolean;
  hint: string | null;
  disabled?: boolean;
  clearRequested: boolean;
  onChange(value: string): void;
  onClearRequested(value: boolean): void;
}

export function CredentialInput({
  value,
  configured,
  hint,
  disabled,
  clearRequested,
  onChange,
  onClearRequested
}: CredentialInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="ai-credential-field">
      <label htmlFor="provider-api-key">API 密钥</label>
      <div className="ai-secret-control">
        <KeyRound size={17} aria-hidden="true" />
        <input
          id="provider-api-key"
          type={visible ? "text" : "password"}
          value={value}
          disabled={disabled || clearRequested}
          autoComplete="new-password"
          placeholder={configured ? "输入新密钥以替换现有凭据" : "输入 API 密钥（可选）"}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="ai-icon-button"
          aria-label={visible ? "隐藏密钥" : "显示密钥"}
          title={visible ? "隐藏密钥" : "显示密钥"}
          disabled={disabled || clearRequested}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      <div className="ai-credential-status">
        <span>
          {clearRequested
            ? "保存后将删除凭据"
            : configured
              ? `已保存凭据${hint ? `（${hint}）` : ""}，密钥不会重新显示`
              : "尚未保存凭据"}
        </span>
        {configured ? (
          <button
            type="button"
            className="ai-text-command ai-danger-command"
            disabled={disabled}
            onClick={() => {
              onChange("");
              onClearRequested(!clearRequested);
            }}
          >
            <X size={15} aria-hidden="true" />
            {clearRequested ? "保留凭据" : "删除凭据"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
