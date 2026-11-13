"use strict";

/**
 * 设计令牌约束：tokens.css 是唯一允许写死字号 / 字体栈 / 圆角数值的文件。
 * 已有遗留写法记录在 design-token-baseline.json 中，只允许减少、不允许新增。
 * 用法：node scripts/verify-design-tokens.cjs [--update]
 */

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const stylesDir = path.join(projectRoot, "apps/web/src/styles");
const tokenPath = path.join(stylesDir, "tokens.css");
const baselinePath = path.join(__dirname, "design-token-baseline.json");
const tokenFileName = "tokens.css";

// 也检查 font 简写，避免用 font: 700 13px/... 绕过令牌约束。
const checkedProperties = ["font-size", "font-family", "border-radius", "font"];
const allowedValues = /^(?:var\(|inherit|initial|unset|revert|0|50%|100%)/;
const requiredTokens = [
  "--font-display",
  "--font-body",
  "--font-number",
  "--shape-cut",
  "--shape-panel-radius",
  "--night-800",
  "--moon-100",
  "--candle-400",
  "--blood-400",
  "--motion-quick",
  "--scene-ease",
  "--type-display-size",
  "--type-role-size",
  "--type-caption-size"
];

function assert(condition, message) {
  if (!condition) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
}

function collectSignatures() {
  if (!fs.existsSync(tokenPath)) return null;
  const signatures = new Set();
  const files = fs.readdirSync(stylesDir).filter((file) => file.endsWith(".css") && file !== tokenFileName).sort();
  for (const file of files) {
    const source = fs.readFileSync(path.join(stylesDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const declaration = new RegExp(`\\b(?:${checkedProperties.join("|")})\\s*:\\s*([^;}]+)`, "g");
    for (const match of source.matchAll(declaration)) {
      const value = match[1].trim();
      if (allowedValues.test(value)) continue;
      signatures.add(`${file}|${value}`);
    }
  }
  return [...signatures].sort();
}

assert(fs.existsSync(tokenPath), "apps/web/src/styles/tokens.css is missing; it is the single source of truth for design values");
const tokenSource = fs.readFileSync(tokenPath, "utf8");
for (const token of requiredTokens) {
  assert(tokenSource.includes(`${token}:`), `tokens.css must define ${token}`);
}

const current = collectSignatures();

if (process.argv.includes("--update")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify({ version: 1, signatures: current }, null, 2)}\n`);
  console.log(`Design token baseline updated: ${current.length} legacy declarations recorded.`);
  process.exit(0);
}

assert(fs.existsSync(baselinePath), "design-token-baseline.json is missing; run verify:design --update once with review");
let baseline;
try {
  baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
} catch (error) {
  console.error(`ERROR: design-token-baseline.json is not valid JSON: ${error.message}`);
  process.exit(1);
}
assert(Array.isArray(baseline.signatures), "design-token-baseline.json is malformed");
const known = new Set(baseline.signatures);
const added = current.filter((signature) => !known.has(signature));

assert(
  added.length === 0,
  `${added.length} new raw design value(s) outside tokens.css:\n${added.map((item) => `  ${item}`).join("\n")}\n` +
    "Use var(--type-*-size), .type-* utilities, var(--font-*) or var(--shape-*). " +
    "If a legacy exception is truly unavoidable, review it and run verify:design --update."
);

const removed = baseline.signatures.length - current.length;
console.log(`Design tokens verified (${current.length} legacy declarations, ${Math.max(0, removed)} migrated).`);
