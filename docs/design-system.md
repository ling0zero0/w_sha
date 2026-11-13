# 设计系统：月夜铭文（Moonlit Inscription）

本文件是这个游戏 **唯一的前端视觉规范**。新增或修改任何样式前先读它；具体数值只在 `apps/web/src/styles/tokens.css` 定义，业务样式引用变量或使用工具类，由 `scripts/verify-design-tokens.cjs` 强制校验。

## 1. 定位与原则

游戏是朋友聚会的局域网狼人杀：一台 Windows 主机作为公共屏幕，其余人用手机浏览器。素材是月光下的中世纪村庄、哥特银藤卡背、烛火与月相。UI 要像**"从这副牌里长出来的"**，而不是一个后台管理页面。

1. **同源**：形状、色彩、纹样都从已有插画/卡背反推，不引入第二套风格，不套用通用组件库。
2. **离线自足**：不加载远程字体、CDN 或图标服务；所有资源在 `apps/web/public/assets/`。
3. **可用优先于华丽**：44px 触控目标、对比度、`prefers-reduced-motion`、私密身份即时卸载不可让步。
4. **约束可执行**：规范写在 token 和校验脚本里，而不是只写在文档里。

风格名 **月夜铭文**：深蓝夜幕、月银文字、烛金主操作、血珀危险、切角金属牌、衬线铭文。

## 2. 文件分工

| 文件 | 职责 | 允许写死数值 |
| --- | --- | --- |
| `styles/tokens.css` | **唯一真源**：色板、字体族、字号层级、形状、间距、层级、动效 | ✅ 只允许这里 |
| `styles/base.css` | 全局重置与焦点样式 | ❌ |
| `styles/host.css` / `player.css` / `ai.css` | 各端布局与结构 | ❌（遗留写法已记入基线） |
| `styles/motion.css` | 交互反馈与减少动画降级 | ❌ |
| `styles/visuals.css` | 主题覆盖、形状工具类、排版工具类、仪式动效 | ❌ |
| `styles/responsive.css` | 断点与安全区 | ❌ |

## 3. 字体

### v1（当前，零资产零授权风险）

| 用途 | 栈 | 说明 |
| --- | --- | --- |
| 展示/标题/铭牌 | `Georgia, "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif` | 西文 Georgia，中文依次回退到宋体系；Windows 落到 SimSun |
| 正文/控件 | `"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif` | 系统无衬线，保证小字可读 |
| 数字（房间号、倒计时、编号） | `Georgia, "Times New Roman", serif` + `font-variant-numeric: tabular-nums` | 等宽数字避免倒计时跳动 |
| 代码/密钥 | `Consolas, "Courier New", monospace` | 仅 AI 密钥等场景 |

**识别度来自排版规则而非字体文件**：展示字用 `0.02em–0.2em` 字距、眉标用 `0.18em` 大写小字、数字用等宽、标题与正文严格分族。禁止用系统 UI 字体做标题，禁止 `font-family` 裸栈出现在非 token 文件。

### v2（待决策，需用户确认）

自带**子集化**衬线字体 woff2（Noto Serif SC / Source Han Serif SC，OFL 授权），只保留 UI 实际用到的汉字与西文，约 30–80KB，放 `public/assets/fonts/`，`@font-face` + `font-display: swap`。收益是 Windows / iOS / Android 上标题完全一致；代价是新增二进制资产、授权声明与打包体积。未经确认不实施。

## 4. 字号层级

业务样式 **禁止裸写 `font-size`**，用 `.type-*` 工具类或 `var(--type-<level>-*)`。

| 级别 | 工具类 | 字号 | 行高 | 字重 | 字距 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| display | `.type-display` | `clamp(36px, 4.2vw, 58px)` | 1.05 | 700 | 0.02em | 大厅主标题 |
| title | `.type-title` | `clamp(30px, 3vw, 44px)` | 1.12 | 700 | 0.04em | 页面标题 |
| role | `.type-role` | `clamp(48px, 14vw, 78px)` | 1 | 800 | 0.12em | 身份名 |
| section | `.type-section` | 20px | 1.3 | 700 | 0.08em | 区块标题 |
| body | `.type-body` | 15px | 1.65 | 400 | 0 | 正文 |
| label | `.type-label` | 13px | 1.4 | 700 | 0.06em | 字段/按钮文字 |
| caption | `.type-caption` | 11px | 1.4 | 800 | 0.18em | 眉标、辅助说明 |
| number | `.type-number` | `clamp(28px, 3vw, 43px)` | 1 | 700 | 0.06em | 房间号、倒计时 |
| plate | `.type-plate` | `clamp(15px, 4.6vw, 20px)` | 1.2 | 700 | 0.2em | 卡牌铭牌 |

规则：同一屏最多出现 3 个级别；`caption` 只做眉标/脚注，不承载正文；`role`/`number` 不换行；移动端不缩小到 12px 以下。

## 5. 形状系统

| token | 值 | 用途 |
| --- | --- | --- |
| `--shape-cut` | 10px | 切角尺寸 |
| `--shape-panel-radius` | 3px | 面板外框 |
| `--shape-card-radius` | 7px | 身份卡、卡面 |
| `--shape-control-radius` | 2px | 按钮、输入框 |
| `--shape-pill-radius` | 999px | 状态圆点 |

- **面板**：`--edge-silver` 外边 + `--edge-inner` 内描边 + 顶部内高光 + `--elevation-1`；四角用纯 CSS 多重渐变画 L 形包角（上两角烛金、下两角月银），呼应卡背金属件。不新增图片。
- **切角**：`.shape-chamfer` 用 `clip-path: polygon(...)`。注意 `clip-path` 会裁掉外部 `box-shadow`，需要外层 wrapper 用 `filter: drop-shadow()`；有焦点轮廓的交互控件不要加切角。
- **控件**：2px 微圆角 + 内高光（按钮）/ 内凹（输入框），保留 44px 触控与既有 hover 反馈。
- **身份卡**：复用 `card-back-640.webp` 做卡框纹理，银边、内外阴影、烛金铭牌，正反面共用同一套框。

禁止：把所有元素统一改成大圆角（会变成 SaaS/App 风）、用纯色块 + 1px 边框做所有容器。

## 6. 色彩

业务样式引用**语义层**，不直接引用世界色：

- 文字：`--text-primary`（月白）、`--text-secondary`（月银灰）、`--text-on-paper`
- 表面：`--surface-night`、`--surface-paper`
- 描边：`--edge-silver`、`--edge-inner`、`--edge-gold`
- 强调：`--accent`（烛金）、`--danger`（血珀）；语义色只表达状态，不表达阵营装饰

世界色 `--night-*`、`--moon-*`、`--silver-*`、`--candle-*`、`--blood-*` 只在 tokens.css 与视觉层内部使用。

昼夜差异靠**色温**切换：夜晚深蓝夜幕，白天暖化月光纸，身份屏最深；不是换两套组件。

## 7. 间距、层级、动效

- 间距：4px 基准，`--space-1` … `--space-8`（4/8/12/16/24/32px）。
- 层级：`--z-scene` 0、`--z-content` 1、`--z-veil` 2、`--z-overlay` 10；投影 `--elevation-1/2/3`。
- 动效：反馈 `--motion-quick` 140ms、入场 `--motion-enter` 240ms、仪式 `--motion-ritual` 620ms、光泽 `--motion-sheen` 720ms；曲线 `--motion-ease` / `--scene-ease`。`motion.css` 的 `prefers-reduced-motion` 用 `!important` 统一禁用，新增动画不得绕过。粗指针/窄屏不引入 `backdrop-filter`。

## 8. 约束机制（可执行）

1. `apps/web/src/styles/tokens.css` 是唯一允许写死 `font-size` / `font-family` / `border-radius` 字面量的文件。
2. `scripts/verify-design-tokens.cjs` 扫描其余 CSS，把遗留写法记在 `scripts/design-token-baseline.json` 中；**只允许减少、不允许新增**。新增违规会直接失败并打印具体位置。
3. 校验挂进 `corepack pnpm check`（因此 `check:all` 与 CI 的 `check` 步骤都会执行），也可单独运行 `corepack pnpm verify:design`。
4. `apps/web/src/styles/tokens.test.ts` 断言每个字号级别五项属性齐全、必需 token 存在、`tokens.css` 内所有 `var()` 引用都能解析。
5. 确实需要新增遗留例外时，必须评审后运行 `corepack pnpm verify:design:update` 重建基线，并在 PR 中说明理由。

### Do / Don't

- ✅ 新样式用 `.type-*` 或 `var(--type-*-size)`；新颜色用语义 token；新圆角用 `--shape-*`。
- ✅ 新面板加 `.ornate-panel` 风格（双层边 + 四角包角），需要异形再加 `.shape-chamfer`。
- ❌ 不要在业务 CSS 里写 `font-size: 13px`、`font-family: Georgia...`、`border-radius: 4px`、`#e3b85f`。
- ❌ 不要引入远程字体、UI 组件库、图标 CDN 或新的动画依赖。
- ❌ 不要为动效破坏 44px 触控、`reduced-motion` 降级、隐藏身份时图片真卸载。

## 9. 迁移与验收

- **已完成**：令牌单一真源、字号层级与工具类、形状系统、语义色、首屏面板包角与切角、月夜村庄遮罩放亮、卡牌铭牌排版、基线校验与单测。
- **进行中**：`host.css` / `player.css` 里 52 条遗留裸写值按基线逐步迁移，每次迁移后基线数量应下降。
- **待办**：v2 自带子集字体（需决策）、场景插画接入阶段背景与胜负大图、常驻月雾层、Web Audio 音效层、法官叙事文案、View Transitions 跨阶段共享元素。

验收命令：`corepack pnpm check:all`、`corepack pnpm quality`、`corepack pnpm verify:design`、`corepack pnpm screenshots:readme`。任何 UI 改动都要重生成 `docs/screenshots/` 并复核窄屏 320px 与 `reduced-motion`。
