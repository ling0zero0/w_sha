# 完整性、多平台稳定性与游戏体验升级

检查日期：2026-11-12。以本轮实际命令、源码审查和浏览器结果为准；旧 optimization-plan.md 的历史完成状态不代表本轮重新验收。

## 结论与范围

项目已有完整大厅、身份隔离、夜间行动、投票、结算、机器人、AI 管理和 Windows 发布链。源码单元测试不能替代真实局域网、多浏览器及异常断电验收。本轮安排服务端 reviewer、accessibility-inclusive-design、apple-design 三个只读审查子智能体；视觉实现与服务端实现由两名 worker 分别串行工作或使用独立工作树，父代理合入并统一验证。

## 本轮实施

- 动效：集中 motion.css，140ms 按钮反馈、240ms transform/opacity 入场，细边框与暗金主操作；危险操作保留红色语义；不对倒计时、聊天和名单持续更新重播动效。
- 输入适配：hover 仅启用在精细指针设备；控件至少 44px；隐藏 radio 的可见标签、密钥输入组增加焦点提示；目标按钮使用 aria-pressed；AI tabs 支持左右键、Home/End、唯一 Tab 入口及命名面板。
- 减少动画：禁用非必要 animation/transition，翻牌改为正反面即时可见性切换；收起身份仍立即卸载私密图片。窄屏与粗指针设备取消大面积 backdrop-filter。
- 角色图片：保留原 PNG，新增 320/640px WebP、picture/srcset 与异步解码；结算图片懒加载。PNG 共 17,837,685 bytes，640px WebP 共约 540 KB，两种 WebP 合计 702,628 bytes。生成脚本 scripts/optimize-role-assets.py 需要 Python/Pillow，仅供开发资源生成。
- 聊天：读历史时保留位置，接近底部时跟随；新增“有新消息 · 跳到最新”。依赖最后消息 ID 而非数组长度，支持有限窗口等长替换。
- 剪贴板：权限失败/API 不可用时显示完整只读邀请链接供手动选中复制。
- 服务端：暂停期间延后离线发言者自动跳过，恢复后重新验证；终止清除待处理猎人技能且拒绝终局技能；清理定时器/机器人任务，取消后不执行迟到响应；实际 AI token 不再截断，保守预留输入加输出，超支记账并拒绝后续请求；修复启动错误路径 actionLedger TDZ。
- 依赖：当前主版本内更新生产依赖；修正 fast-uri/brace-expansion 的旧覆盖规则。升级后生产依赖 audit 返回 No known vulnerabilities found，此结论仅对应运行时的公告库。
- 跨平台测试：Playwright 使用 webServer.env 代替 Windows set，增加端口变量 E2E_API_PORT/E2E_WEB_PORT；配置 Chromium、Firefox、WebKit，Firefox 不使用不支持的 isMobile；默认 test:e2e 保持 Chromium，test:e2e:cross 执行三引擎。CI 添加 Windows/Linux/macOS 矩阵和浏览器安装步骤，尚不能视为远程 CI 已通过。
- 最低 Node：22.13.0，保证 node:sqlite 可不加实验开关导入；同步引擎声明、仓库验证器、README 和 CI。

## 仍需实施的发布阻塞项

### P1：持久化原子性

socket/context.ts 操作后同步写 ledger、ACK，快照通过 setImmediate 后写，崩溃可能导致成功结果与恢复状态不一致。仅交换写入顺序无法保证原子性。

下一阶段：统一 SQLite 事务协调器；同事务提交状态、action ledger、聊天等持久化副作用；COMMIT 后 ACK/广播；设计失败时内存回滚；兼容接管 metadata 与备份恢复。增加子进程故障注入：提交前崩溃、提交后 ACK 前崩溃、重试重放、磁盘失败。负责角色：服务端 worker，独立 reviewer 验收。该项未完成前不宣称崩溃安全发布就绪。

### P1：实机验收与测试隔离的后续工作

本轮已加入每项测试前后的大厅清理夹具，终止并等待实际状态确认、移除残留玩家、重置角色和讨论模式；将测试阶段上限从 500ms 调为 30s，完成阶段仍可在 50ms 后推进，生产时长不变。修正原生 radio 的 checked 断言和最后发言者结束后已进入投票的预期。后续可进一步使用独立服务/数据库替代共享房间，并增强失败注入隔离。

真实 iPhone Safari/微信、Android Chrome/微信及 Windows 防火墙仍需按照 release-acceptance.md 完整验证：扫码、软键盘、横竖屏、安全区、后台锁屏、断网重连、主机重启、完整对局。WebKit 与 UA 仿真不能替代实机。

## 后续性能规划与验收

1. 在一台低端 Android 与 iPhone 录制长任务、掉帧与交互延迟。以 INP 75 分位不高于 200ms 为长期目标；动画以设备刷新周期为预算，60Hz 约 16.7ms。未实测前不宣称稳定 60fps。
2. 根据测量优化聊天合并/渲染、公共状态广播和大名单更新；超过实际负载再引入窗口化，避免盲目增加框架依赖。
3. 分割 AI 管理路由 JavaScript、按需预载当前身份图，测量缓存和重复进入；局域网 HTTP 的安装/离线能力须按实际浏览器安全上下文说明。
4. Linux/macOS 先通过源码服务 CI 与启动冒烟，再决定原生产物。当前 portable/安装器只支持 Windows；Windows DPAPI 密钥不能直接搬迁至其他系统。
5. 动效只用视觉反馈，不延迟操作、不让已失效目标或私密身份为退出动画继续显示。重大依赖主版本升级单独计划，先验证 Node、构建、游戏协议及第三方 API 兼容。

## 网络依据（官方资料）

- web.dev《How to create high-performance CSS animations》：https://web.dev/articles/animations-guide — 优先 transform/opacity，避免布局重排，不给所有元素常驻 will-change。
- web.dev《prefers-reduced-motion》：https://web.dev/articles/prefers-reduced-motion — 尊重系统减少动态效果设置。
- web.dev《Interaction to Next Paint》：https://web.dev/articles/inp — 交互响应测量与 200ms 良好阈值。
- Playwright Browsers / Emulation：https://playwright.dev/docs/browsers 、https://playwright.dev/docs/emulation — 真实引擎与设备参数模拟的区别。
- WAI-ARIA Tabs Pattern：https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ — 页签键盘和关联语义。
- Node SQLite：https://nodejs.org/api/sqlite.html — 模块可用版本及实验开关历史。

部分页面抓取失败时使用搜索返回的官方摘录；未根据非官方教程引入动效依赖。

## 验证记录

- 修改前：296 项 Vitest 通过；production audit 18 high，quality 阻塞。
- 合入服务端与 Web 修复后：317 项 Vitest 通过（shared 35/server 242/web 40）；typecheck 和生产 build 通过。
- LSP：改动路径无已报错误；push-only 服务的未确认项使用完整 TypeScript 检查补充，不能将静默等同于已确认无错。
- 最终 `corepack pnpm check:all` 返回 code 0：317 项 Vitest、全部类型检查（含 E2E/Playwright 配置）、生产构建、Chromium 11 项 E2E 全部通过。原始汇总日志见 [upgrade-validation.txt](upgrade-validation.txt)。
- `corepack pnpm quality` 通过，包括增量 lint/format、production audit 和 verify:repo；audit 未发现已知漏洞。
- 浏览器初次运行暴露旧断言错误（原生 radio 应 toBeChecked，而非要求 aria-checked 属性）、隐藏 radio 应测量可点击 label、500ms 操作窗口及流程清理/共享房间污染问题，均已修正。
- 当前实测环境为 Windows / Node v24.12.0；CI 声明的最低 Node 22.13.0 与 Linux/macOS 矩阵尚待远程执行。
- 低端手机帧率、INP 和真实无线网络延迟尚未测量；图片体积下降不等于已证明所有设备稳定 60fps。
- 主持人和手机入口截图已生成：[主持人](screenshots/host-experience-upgrade.png)、[手机入口](screenshots/player-experience-upgrade.png)。
- 独立 reviewer 未发现新 P1；指出聊天记录应可用 Tab 聚焦，本轮已修复并在完整流程检查键盘焦点。
- 跨引擎：Chromium 11 项完整通过；WebKit/Firefox 每个引擎 11 项均有通过记录。后两者的合并 22 项运行曾有 2 项失败，其余 20 项通过；修正后 WebKit 身份牌用例单独通过，Firefox 动效两项通过，Chromium/WebKit 桌面反馈再验证两项通过。不能将这一记录表述为最后一次完整 cross 命令一次全绿。
- WebKit 的卡牌断言需要先暂停阶段，避免阶段变化主动隐藏身份；Firefox 原生 Space 激活不必与鼠标呈现同样的 CSS :active。测试分别验证鼠标按压和键盘激活，没有移除隐私断言。
