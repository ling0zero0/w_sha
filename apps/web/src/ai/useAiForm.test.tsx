import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useAiForm } from "./useAiForm";

function Probe() {
  const form = useAiForm({ name: "默认模型", enabled: true });
  return <span>{`${form.values.name}|${String(form.values.enabled)}|${String(form.saving)}|${form.status.kind}`}</span>;
}

describe("useAiForm", () => {
  it("starts from the provided values with an idle status", () => {
    const markup = renderToStaticMarkup(<Probe />);
    expect(markup).toContain("默认模型|true|false|idle");
  });
});
