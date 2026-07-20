import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode
} from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [initial, vi.fn()]
  };
});

import { CredentialInput } from "./CredentialInput";

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | undefined {
  if (!isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Children.toArray(children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}

describe("CredentialInput", () => {
  it("shows saved status without placing the saved key in the input or tree", () => {
    const savedKey = "never-render-this-secret";
    const field = CredentialInput({
      value: "",
      configured: true,
      hint: "末尾 4 位：cret",
      clearRequested: false,
      onChange: vi.fn(),
      onClearRequested: vi.fn()
    });
    const input = findElement(field, (element) => element.type === "input");

    expect((input?.props as { value?: string }).value).toBe("");
    expect((input?.props as { autoComplete?: string }).autoComplete).toBe("new-password");
    expect(JSON.stringify(field)).not.toContain(savedKey);
    expect(JSON.stringify(field)).toContain("密钥不会重新显示");
  });

  it("clears the visible replacement value before requesting credential deletion", () => {
    const onChange = vi.fn();
    const onClearRequested = vi.fn();
    const field = CredentialInput({
      value: "replacement",
      configured: true,
      hint: null,
      clearRequested: false,
      onChange,
      onClearRequested
    });
    const clearButton = findElement(
      field,
      (element) => (element.props as { className?: string }).className?.includes("ai-danger-command") ?? false
    );

    (clearButton?.props as { onClick(): void }).onClick();
    expect(onChange).toHaveBeenCalledWith("");
    expect(onClearRequested).toHaveBeenCalledWith(true);
  });
});
