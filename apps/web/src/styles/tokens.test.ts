import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const declared = new Set([...source.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
const levels = ["display", "title", "role", "section", "body", "label", "caption", "number", "plate"];

describe("design tokens", () => {
  it("defines every typography level with a complete set of attributes", () => {
    for (const level of levels) {
      for (const part of ["size", "leading", "weight", "tracking", "family"]) {
        expect(declared.has(`--type-${level}-${part}`), `--type-${level}-${part}`).toBe(true);
      }
    }
  });

  it("defines the shape, palette, motion and font families", () => {
    for (const name of [
      "--shape-cut",
      "--shape-panel-radius",
      "--shape-card-radius",
      "--shape-control-radius",
      "--font-display",
      "--font-body",
      "--font-number",
      "--night-800",
      "--moon-100",
      "--candle-400",
      "--blood-400",
      "--edge-silver",
      "--motion-quick",
      "--scene-ease"
    ]) {
      expect(declared.has(name), name).toBe(true);
    }
  });

  it("resolves every var() reference declared inside tokens.css", () => {
    const references = [...source.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(declared.has(reference), `${reference} is not declared`).toBe(true);
    }
  });
});
