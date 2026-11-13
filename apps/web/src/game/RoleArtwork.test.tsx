import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoleArtwork } from "./RoleArtwork";

// 通过 props 对象传递游戏角色，避免把 `role` 误判为 ARIA role 属性。
function renderCard(props: ComponentProps<typeof RoleArtwork>): string {
  return renderToStaticMarkup(<RoleArtwork {...props} />);
}

describe("RoleArtwork", () => {
  it("renders a framed card with a name plate when requested", () => {
    const html = renderCard({ role: "wolf", plate: true });

    expect(html).toContain("has-card-frame");
    expect(html).toContain("role-card-surface");
    expect(html).toContain("role-card-plate");
    expect(html).toContain("狼人阵营");
    expect(html).toContain('alt="狼人身份牌"');
    expect(html).toContain("/assets/roles/wolf-320.webp");
  });

  it("unmounts the private image and plate when the card is hidden", () => {
    const html = renderCard({ role: "seer", plate: true, hidden: true });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("身份牌");
    expect(html).not.toContain("role-card-plate");
    expect(html).not.toContain("has-card-frame");
  });

  it("omits the plate by default while keeping the frame and accessible alt text", () => {
    const html = renderCard({ role: "guard" });

    expect(html).toContain("has-card-frame");
    expect(html).not.toContain("role-card-plate");
    expect(html).toContain('alt="守卫身份牌"');
  });
});
