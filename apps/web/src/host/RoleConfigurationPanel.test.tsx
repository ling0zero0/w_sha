import type { ReactElement, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useState(initial: unknown) {
      return [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()];
    }
  };
});

import { RoleConfigurationPanel } from "./RoleConfigurationPanel";

function findElements(node: ReactNode, predicate: (element: ReactElement) => boolean, matches: ReactElement[] = []): ReactElement[] {
  if (!isValidElement(node)) return matches;
  if (predicate(node)) matches.push(node);

  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Children.toArray(children)) {
    findElements(child, predicate, matches);
  }
  return matches;
}

function renderPanel(connected: boolean, onChatModeChange = vi.fn()) {
  return RoleConfigurationPanel({
    configuration: {
      wolf: 2,
      villager: 3,
      seer: 1,
      witch: 1,
      guard: 0,
      hunter: 0,
      idiot: 0
    },
    chatMode: "open",
    readiness: {
      ready: true,
      participantCount: 7,
      configuredRoleCount: 7,
      issues: []
    },
    connected,
    onChange: vi.fn(),
    onChatModeChange,
    onStart: vi.fn()
  });
}

describe("RoleConfigurationPanel chat mode", () => {
  it("renders an accessible segmented radio control and emits a selection", () => {
    const onChatModeChange = vi.fn();
    const panel = renderPanel(true, onChatModeChange);
    const options = findElements(
      panel,
      (element) => element.type === "input" && (element.props as { type?: string }).type === "radio"
    );

    expect(options).toHaveLength(2);
    expect((options[0] as { props: { checked: boolean } }).props.checked).toBe(false);
    expect((options[1] as { props: { checked: boolean } }).props.checked).toBe(true);

    (options[0] as { props: { onChange: () => void } }).props.onChange();
    expect(onChatModeChange).toHaveBeenCalledWith("ordered");
  });

  it("disables both mode options while disconnected", () => {
    const panel = renderPanel(false);
    const options = findElements(
      panel,
      (element) => element.type === "input" && (element.props as { type?: string }).type === "radio"
    );

    expect(options.every((option) => (option as { props: { disabled?: boolean } }).props.disabled)).toBe(true);
  });
});
