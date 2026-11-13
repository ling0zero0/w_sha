# 前端视觉层升级（月夜哥特）

检查日期：2026-11-13。针对"功能齐全但缺少游戏质感"的反馈，本轮只改表现层：配色、UI 特色、身份卡质感、特效与过渡。不改状态逻辑、协议、网络与服务端行为。

## 方向

已有素材已经定义了风格：`apps/web/public/assets/roles/*.webp` 是月光村庄的写实插画，`card-back-640.webp` 是哥特银藤浮雕 + 月/山/钟楼 + 暗红宝石 + 四角金属件，`lobby-1600.webp` 是蓝月夜山村。原 UI 用的是中性绿灰黑 + 米白纸 + 纯金的通用后台配色，与素材冲突。本轮把界面收敛到素材的"月夜哥特村庄"语言，不引入第二套风格，也不重画素材。

## 色板（`styles/base.css`）

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--night-900` / `--night-800` / `--night-700` | `#080e17` / `#0b1420` / `#111e2d` | 夜幕底色 |
| `--moon-100` / `--moon-300` | `#e8edf2` / `#b8c4d2` | 月白文字 |
| `--silver-400` | `#8b949c` | 藤银描边、卡框 |
| `--candle-400` / `--candle-300` | `#d9a15c` / `#edc688` | 烛金主操作与高光 |
| `--blood-500` / `--blood-400` | `#8e3b3b` / `#b0524a` | 狼人 / 危险 |
| `--scene-ease` | `cubic-bezier(0.22, 0.8, 0.24, 1)` | 仪式动效曲线 |

旧令牌（`--amber` / `--green` / `--red` / `--paper` / `--ink`）保留，避免大范围改动引起可读性回退。

## 世界分层（`styles/visuals.css`）

- 主机 / AI 端：深蓝夜幕渐变 + 顶部月光晕，保留 `lobby-scene` 村庄插画。
- 玩家端：冷调"月光纸"渐变 + 极淡纸纹，**保留深色文字可读**，不整体翻暗。
- 夜晚身份屏（`.role-screen`）：深蓝夜幕 + 月白文字 + 烛金 / 血珀阵营标题。
- 白天（`.day-shell`）：暖化破晓纸色，与夜晚形成明确昼夜差异（此前 `.day-shell` 在 CSS 中根本没有定义）。
- 结算：按 `data-outcome` 给月银（好人胜）或血珀（狼人胜）光晕；天亮结果加曙光渐变。

## 身份卡（`game/RoleArtwork.tsx`）

原来 DOM 里只有 `<picture><img></picture>` + 一圈金边 + 外阴影，所以像贴图。现在：

- `.role-artwork-frame.has-card-frame`：用已有 `card-back-640.webp` 铺底做卡框纹理，配银边、内外阴影、圆角。
- `.role-card-surface`：内层图片容器，细银内描边。
- `.role-card-plate`（`plate` 开启）：底部渐变铭牌、衬线角色名 + 字距 + 烛金光晕、阵营小字，`aria-hidden` 避免重复朗读。
- 卡面光泽：`.role-card-surface::after` 伪元素，精细指针设备 hover 时扫过；`prefers-reduced-motion` 下直接隐藏。用伪元素而非实体节点，是为了让几何始终等于卡面，不触发窄屏横向溢出审计。
- 白天翻牌正反面共用卡框语言，翻面 `620ms` 自定义曲线 + 光扫 + 投影变化。

`hidden` 时组件仍返回 `null`——私密身份图片与铭牌都真正卸载，不靠 CSS 遮挡，原有隐私测试不变。启用铭牌的位置：身份揭示屏、白天翻牌正面；结算卡保留卡框但不加铭牌（下方已有角色名）。

## 动效与过渡

- **揭幕层**：`.player-shell::before` 在每次阶段挂载时做一次 620ms 淡出，把"硬切"变成有入场的换幕；默认 `opacity: 0`，减少动画时不会残留暗层。
- **仪式节点**：身份标题字距展开、天亮曙光扫过、结算胜负光晕、翻牌光扫。
- **分层原则**：常驻反馈仍为 140ms 按钮 / 240ms 入场（`motion.css`），新增动画全部是一次性、只作用于 `transform` / `opacity` / `letter-spacing` 等相关属性，不绑定倒计时、聊天消息、名单行。
- **降级**：`motion.css` 的 `@media (prefers-reduced-motion: reduce)` 用 `!important` 统一禁用全部 `animation` / `transition`（含伪元素）；粗指针 / 窄屏仍取消大面积 `backdrop-filter`，本轮未新增任何 `backdrop-filter`。

## 约束与未改动项

- 不改按钮 hover 的 `translateY(-1px)` / 背景渐变反馈（`tests/e2e/motion.spec.ts` 断言依赖）。
- 不改 `.join-form` 的 `content-enter` 入场动画名与"不重播"行为。
- 不引入远程字体、CDN、音效或第三方动画库；局域网离线可用。
- 保持 44px 触控目标、`data-testid`、现有文案与身份隔离语义。
- 场景插画已在后续的设计系统升级中接入：见 [design-system.md](design-system.md) 的「阶段场景：游戏的世界底色」。生产代码只引用 `/assets/scenes/` 的 WebP，不引用 `incoming-assets`。
- 未做 Web Audio 音效层、View Transitions 跨阶段共享元素、法官叙事文案；这些留作下一阶段，需先实机测量 INP 与移动端耗电。毒药/解药道具图已生成但尚未接入女巫面板。

## 验证

- `corepack pnpm check:all`：类型检查（含 E2E 配置）、Vitest、生产构建、Chromium E2E。
- `corepack pnpm verify:repo`：仓库结构校验，确保生产代码不引用 `incoming-assets`。
- `corepack pnpm screenshots:readme`：更新 `docs/screenshots/*-experience-upgrade.png`。
- 新增 `apps/web/src/game/RoleArtwork.test.tsx` 覆盖铭牌渲染与隐藏时卸载；`tests/e2e/motion.spec.ts` 增加卡框、铭牌、昼夜背景差异与减少动画断言。
