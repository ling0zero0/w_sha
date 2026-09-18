import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormStatus } from "./FormStatus";

describe("FormStatus", () => {
  it("renders nothing while idle", () => {
    expect(renderToStaticMarkup(<FormStatus status={{ kind: "idle", message: "" }} />)).toBe("");
  });

  it("renders errors as alerts", () => {
    const markup = renderToStaticMarkup(<FormStatus status={{ kind: "error", message: "保存失败" }} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("is-error");
    expect(markup).toContain("保存失败");
  });

  it("renders successes as status messages", () => {
    const markup = renderToStaticMarkup(<FormStatus status={{ kind: "success", message: "已保存" }} />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("is-success");
    expect(markup).toContain("已保存");
  });
});
