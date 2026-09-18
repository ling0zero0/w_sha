import { useCallback, useState } from "react";

export type AiFormStatusKind = "idle" | "error" | "success";

export interface AiFormStatus {
  kind: AiFormStatusKind;
  message: string;
}

const IDLE_STATUS: AiFormStatus = { kind: "idle", message: "" };

export interface AiForm<T> {
  /** 当前表单字段值。 */
  values: T;
  /** 更新单个字段。 */
  setField<K extends keyof T>(field: K, value: T[K]): void;
  /** 批量更新字段。 */
  update(patch: Partial<T>): void;
  saving: boolean;
  testing: boolean;
  status: AiFormStatus;
  /** 保存：自动维护 saving 与成功/失败提示。 */
  submit(action: () => Promise<void>, successMessage: string, failureMessage: string): Promise<void>;
  /** 连接/模型测试：自动维护 testing 与成功/失败提示。 */
  runTest(action: () => Promise<void>, successMessage: string, failureMessage: string): Promise<void>;
  /** 删除：失败时才复位 saving，成功时交给父级切换选中项。 */
  destroy(action: () => Promise<void>, failureMessage: string): Promise<void>;
}

/**
 * AI 配置面板（服务连接 / 模型 / 机器人档案）共用的表单状态。
 *
 * 三个面板此前各自维护 11–16 个 useState，字段、保存中标记和错误/成功提示
 * 的处理流程逐字重复，这里统一为单一表单状态与三个流程包装器。
 */
export function useAiForm<T extends object>(initial: T): AiForm<T> {
  const [values, setValues] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<AiFormStatus>(IDLE_STATUS);

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  }, []);

  const update = useCallback((patch: Partial<T>) => {
    setValues((current) => ({ ...current, ...patch }));
  }, []);

  function report(kind: AiFormStatusKind, message: string) {
    setStatus({ kind, message });
  }

  async function submit(action: () => Promise<void>, successMessage: string, failureMessage: string) {
    setSaving(true);
    setStatus(IDLE_STATUS);
    try {
      await action();
      report("success", successMessage);
    } catch (caught) {
      report("error", caught instanceof Error ? caught.message : failureMessage);
    } finally {
      setSaving(false);
    }
  }

  async function runTest(action: () => Promise<void>, successMessage: string, failureMessage: string) {
    setTesting(true);
    setStatus(IDLE_STATUS);
    try {
      await action();
      report("success", successMessage);
    } catch (caught) {
      report("error", caught instanceof Error ? caught.message : failureMessage);
    } finally {
      setTesting(false);
    }
  }

  async function destroy(action: () => Promise<void>, failureMessage: string) {
    setSaving(true);
    setStatus(IDLE_STATUS);
    try {
      await action();
    } catch (caught) {
      report("error", caught instanceof Error ? caught.message : failureMessage);
      setSaving(false);
    }
  }

  return { values, setField, update, saving, testing, status, submit, runTest, destroy };
}
