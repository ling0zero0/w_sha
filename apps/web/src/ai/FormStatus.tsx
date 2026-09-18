import { Check } from "lucide-react";
import type { AiFormStatus } from "./useAiForm";

export function FormStatus({ status }: { status: AiFormStatus }) {
  if (status.kind === "idle" || !status.message) return null;
  const isError = status.kind === "error";
  return (
    <p className={`ai-form-status${isError ? " is-error" : " is-success"}`} role={isError ? "alert" : "status"}>
      {isError ? null : <Check size={16} aria-hidden="true" />}
      {status.message}
    </p>
  );
}
