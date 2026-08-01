# 多模型 AI 机器人开发路线

## 1. 目标

在保留现有确定性机器人的前提下，为局域网狼人杀增加可扩展的多模型 AI 平台：

- 主机可在本机管理多个模型供应商连接。
- 每个供应商可配置多个模型。
- 可创建包含人格、发言风格和策略倾向的机器人档案。
- 主持人可在大厅为不同机器人选择不同档案和模型。
- AI 只能读取对应座位授权后的 `PlayerLobbyView`。
- AI 只能提交受 `BotIntent` Schema 约束的动作，不能直接修改房间。
- 外部服务超时、失败、限流或预算耗尽时，游戏仍可通过确定性回退继续。
- API Key、系统提示词和供应商原始响应不得进入玩家视图、Socket 事件、运行时快照或普通日志。

当前实现已覆盖 OpenAI-compatible provider、模型/机器人档案 CRUD、共享房间预算、调用审计和开局配置 revision 锁定；其他 provider、费用换算和真实设备验收仍按后续阶段推进。

## 2. 不变的安全边界

现有执行链继续作为唯一的机器人动作入口：

```text
PlayerLobbyView
  -> BotAdapter.onView()
  -> BotIntent
  -> botIntentSchema
  -> executeBotIntent()
  -> LobbyRoom 公共动作方法
```

必须保持以下约束：

1. `LobbyRoom` 不依赖模型供应商、API Key、提示词、费用或重试策略。
2. `BotAdapter` 不能获得 `LobbyRoom`、主持人视图、其他玩家视图或凭证。
3. `BotIntent` 不包含 actor，执行器通过调用参数绑定机器人 `playerId`。
4. 所有模型结果继续经过共享 Zod Schema 和房间阶段规则校验。
5. `revision` 变化、座位移除、阶段切换和服务关闭都会取消或拒绝旧结果。
6. 供应商故障不能暂停阶段时钟，也不能阻塞其他玩家操作。

## 3. 领域模型

### 3.1 供应商连接

`AiProvider` 描述一个服务连接，不代表具体机器人：

```ts
interface AiProviderView {
  id: string;
  name: string;
  protocol: "openai-compatible-chat";
  baseUrl: string;
  enabled: boolean;
  credentialConfigured: boolean;
  credentialHint: string | null;
  createdAt: string;
  updatedAt: string;
}
```

第一阶段只实现 `openai-compatible-chat`，但内部协议使用判别联合，后续可增加：

- `openai-responses`
- `anthropic-messages`
- `gemini-generate-content`
- 本地模型专用协议

供应商差异必须在适配层归一化，不能进入 `LobbyRoom` 或 `BotIntent`。

### 3.2 模型配置

`AiModelProfile` 描述供应商上的一个可调用模型及运行参数：

```ts
interface AiModelProfile {
  id: string;
  providerId: string;
  name: string;
  model: string;
  enabled: boolean;
  temperature: number | null;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxAttemptsPerTurn: number;
  gameTokenBudget: number;
  fallbackModelProfileId: string | null;
}
```

模型配置不保存人格和狼人杀身份策略。

### 3.3 机器人档案

`AiBotProfile` 描述玩家能感知到的机器人个性：

```ts
interface AiBotProfile {
  id: string;
  name: string;
  defaultNickname: string;
  description: string;
  personalityPrompt: string;
  speakingStyle: string;
  strategy: "cautious" | "balanced" | "aggressive";
  modelProfileId: string;
  enabled: boolean;
}
```

档案不得预先绑定狼人、预言家等秘密身份。具体身份只能来自当前座位的玩家视图。

### 3.4 机器人座位

共享领域调整为：

```ts
type BotKind = "deterministic" | "llm";

type BotConfiguration =
  | { controller: "human"; botKind: null; botProfileId: null }
  | { controller: "bot"; botKind: "deterministic"; botProfileId: null }
  | { controller: "bot"; botKind: "llm"; botProfileId: string };
```

使用判别联合或 `superRefine` 保证字段组合一致，拒绝人类座位携带机器人配置。

玩家公共名单只显示“机器人”和公开档案名。供应商、模型 ID、提示词和预算仅允许主机管理页面读取。

## 4. 持久化设计

AI 配置使用现有 SQLite 文件，但通过独立仓储管理。先建立统一迁移机制，避免继续在各 Store 构造函数中分散执行迁移。

建议表结构：

```text
schema_migrations(
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)

ai_providers(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

ai_provider_secrets(
  provider_id TEXT PRIMARY KEY REFERENCES ai_providers(id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  credential_hint TEXT,
  updated_at TEXT NOT NULL
)

ai_model_profiles(
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id),
  name TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  temperature REAL,
  max_output_tokens INTEGER NOT NULL,
  request_timeout_ms INTEGER NOT NULL,
  max_attempts_per_turn INTEGER NOT NULL,
  game_token_budget INTEGER NOT NULL,
  fallback_model_profile_id TEXT REFERENCES ai_model_profiles(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

ai_bot_profiles(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  default_nickname TEXT NOT NULL,
  description TEXT NOT NULL,
  personality_prompt TEXT NOT NULL,
  speaking_style TEXT NOT NULL,
  strategy TEXT NOT NULL,
  model_profile_id TEXT NOT NULL REFERENCES ai_model_profiles(id),
  enabled INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

ai_usage_events(
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  game_session_id TEXT,
  player_id TEXT NOT NULL,
  bot_profile_id TEXT NOT NULL,
  model_profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_microunits INTEGER,
  created_at TEXT NOT NULL
)

ai_decision_attempts(
  id TEXT PRIMARY KEY,
  game_session_id TEXT,
  player_id TEXT NOT NULL,
  decision_key TEXT NOT NULL,
  room_revision INTEGER NOT NULL,
  bot_profile_id TEXT NOT NULL,
  model_profile_id TEXT NOT NULL,
  status TEXT NOT NULL,
  intent_type TEXT,
  latency_ms INTEGER,
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
)
```

运行时快照升级到版本 3，只保存：

- `botKind`
- `botProfileId`
- 机器人档案 revision
- 无法恢复 AI 时采用的回退策略

快照不得保存 API Key、供应商请求头或原始模型响应。版本 1 和版本 2 快照必须继续恢复。

## 5. 密钥和管理鉴权

### 5.1 管理访问

AI 管理接口使用 REST，游戏动作继续使用 Socket.IO。

所有 `/api/admin/ai/*` 请求必须同时满足：

1. 请求地址来自 loopback。
2. 浏览器 `Origin` 或 `Referer` 来自 loopback。
3. 请求包含 `Authorization: Bearer <hostSession>`。
4. 使用常量时间比较验证令牌。
5. 响应包含 `Cache-Control: no-store`。

管理 API 不接受查询字符串中的密钥或会话令牌。局域网玩家设备不能访问配置列表。

### 5.2 密钥存储

实现可替换的 `SecretBox` 接口：

```ts
interface SecretBox {
  seal(purpose: string, plaintext: string): EncryptedSecret;
  open(purpose: string, encrypted: EncryptedSecret): string;
}
```

第一实现使用 AES-256-GCM：

- 每次加密生成新的 96 位 nonce。
- provider ID 和用途作为附加认证数据。
- 主密钥不写入 SQLite。
- 显式配置时从 `AI_MASTER_KEY` 读取。
- 未显式配置时自动生成随机主密钥，并以限制性文件权限（平台支持时）保存在数据库目录；Windows 打包版本后续增加 DPAPI 保护实现。
- 未配置安全主密钥时，禁止持久化 API Key，不静默降级成明文。

读取接口只返回 `credentialConfigured` 和脱敏提示。空 Key 表示保留旧值；清除凭证必须使用独立字段或独立操作。

日志统一脱敏：

- `authorization`
- `apiKey`
- 自定义供应商请求头
- ciphertext、nonce 和 auth tag
- 系统提示词
- 原始请求与原始响应
- Socket handshake auth

## 6. 管理 REST API

建议路由：

```text
GET    /api/admin/ai/overview

GET    /api/admin/ai/providers
POST   /api/admin/ai/providers
PATCH  /api/admin/ai/providers/:id
DELETE /api/admin/ai/providers/:id
POST   /api/admin/ai/providers/:id/test

GET    /api/admin/ai/models
POST   /api/admin/ai/models
PATCH  /api/admin/ai/models/:id
DELETE /api/admin/ai/models/:id
POST   /api/admin/ai/models/:id/test

GET    /api/admin/ai/bot-profiles
POST   /api/admin/ai/bot-profiles
PATCH  /api/admin/ai/bot-profiles/:id
DELETE /api/admin/ai/bot-profiles/:id

GET    /api/admin/ai/usage
```

连接测试由服务端执行：

- 使用独立 `AbortController` 和短超时。
- 不自动重试。
- 不跟随会把授权头转发到不同主机的重定向。
- 返回分类后的结果：成功、认证失败、模型不存在、限流、连接失败或超时。
- 只返回延迟、时间和脱敏错误，不返回供应商原始 body。
- 明确允许用户配置本机或局域网模型服务，SSRF 策略不能误伤合法本地模型。

## 7. 供应商适配层

新增目录：

```text
apps/server/src/ai/
  ai-config-store.ts
  ai-audit-store.ts
  admin-ai-routes.ts
  secret-box.ts
  redaction.ts
  provider-registry.ts
  model-provider.ts
  decision-gate.ts
  prompt-builder.ts
  llm-bot-adapter.ts
  budget-ledger.ts
  providers/
    openai-compatible.ts
```

统一供应商接口：

```ts
interface ModelProvider {
  decide(
    request: AiDecisionRequest,
    signal: AbortSignal
  ): Promise<AiDecisionResponse>;

  testConnection(
    model: AiModelProfile,
    signal: AbortSignal
  ): Promise<AiConnectionTestResult>;
}
```

供应商输出先归一化为仓库自有协议：

```ts
interface AiModelDecision {
  protocolVersion: 1;
  intent: BotIntent | null;
}
```

供应商响应不得直接进入房间方法。

## 8. 决策门控和提示上下文

当前 `BotManager` 根据每个房间 revision 调度。外部模型接入前必须增加语义门控，防止一次聊天或其他玩家动作触发所有 AI 请求。

门控输出：

```ts
type BotDecisionPlan =
  | { kind: "skip" }
  | { kind: "deterministic"; intent: BotIntent }
  | {
      kind: "llm";
      decisionKey: string;
      allowedIntentTypes: BotIntent["type"][];
    };
```

机械动作本地处理：

- 确认身份
- 已选择目标后的确认
- 模型发言完成后的结束发言
- 没有合法候选人时的弃权或空动作

需要模型的动作：

- 狼人击杀目标
- 预言家查验目标
- 守卫守护目标
- 女巫是否用药及目标
- 猎人是否开枪及目标
- 白天或遗言发言
- 白天投票

`decisionKey` 至少包含：

- 对局 ID
- 天数
- 阶段和夜间子阶段
- 玩家 ID
- 当前动作类型
- 当前候选集合摘要
- 最新授权聊天序列

同一 `decisionKey` 只允许一次有效模型调用，除非进入受控重试。

提示上下文只来自当前 `PlayerLobbyView`：

- 自身身份和状态
- 当前阶段和合法候选人
- 当前座位可见的公开聊天
- 狼人座位合法可见的狼队友和狼人私聊
- 当前机器人档案的人格和策略

玩家聊天是“不可信数据”，必须放入明确的数据区，不能与系统指令拼接成同级文本。提示中明确说明聊天内容不能修改权限、索取密钥或扩大允许动作集合。

## 9. 超时、重试和回退

有效截止时间取以下最小值：

```text
模型配置超时
BotTurnContext.deadlineAt
阶段截止时间 - 执行安全余量
```

策略：

- 保留 500 至 1000 毫秒用于解析、校验和房间执行。
- 网络断开、429 和部分 5xx 最多重试一次，且必须仍有足够时间。
- 认证失败、无效模型和 Schema 无效不对同一模型盲目重试。
- 回退链必须检测循环，最大深度为 4。
- 强制动作最终回退到 `DeterministicBotAdapter`。
- 非强制聊天可以放弃，不得拖延阶段。
- 连续失败的供应商进入内存熔断状态，冷却后再试。
- 阶段切换、暂停、移除座位和服务关闭继续通过 `AbortSignal` 取消请求。

## 10. 预算和审计

调用前预留预算，完成后根据供应商 usage 结算：

- 每局总 Token 上限
- 每个模型配置的每局上限
- 每个机器人座位的调用次数上限
- 可选的估算费用上限

预算不足时不调用供应商，直接采用回退。

默认审计只保存元数据：

- 决策 ID、对局 ID、玩家 ID
- 档案、模型、供应商
- decision key 和 room revision
- 开始、结束和延迟
- 成功、超时、取消、过期、无效输出、预算阻止或回退
- 输入输出 Token 和估算费用
- 最终 Intent 类型

默认不保存完整玩家视图、提示词、私密聊天、目标内容或模型原始响应。

## 11. Web 信息架构

路由调整为显式页面：

```text
/                主持人大厅
/ai              AI 玩家管理
/join/:roomCode  玩家端
其他路径          未找到页面
```

不引入路由库也可以完成，使用类型化本地路由即可。

提取共享 `HostShell`，提供：

- 大厅和 AI 玩家导航
- 主机服务状态
- 返回大厅
- 本地管理访问错误

AI 页面分为三个标签：

1. 服务连接
2. 模型
3. 机器人档案

组件建议：

```text
host/
  HostShell.tsx
  HostNavigation.tsx

ai/
  AiManagementScreen.tsx
  useAiConfiguration.ts
  ProviderList.tsx
  ProviderForm.tsx
  ModelList.tsx
  ModelForm.tsx
  BotProfileList.tsx
  BotProfileForm.tsx
  CredentialInput.tsx
  ConnectionTestStatus.tsx
```

每个表单维护独立的加载、保存、测试、成功和错误状态，不复用当前大厅的单一页面错误。

移动端采用列表和详情的单列布局；桌面端使用窄导航和流式编辑区。长 endpoint、模型 ID 和档案名称必须换行或截断，不能挤压按钮。

## 12. 大厅交互

现有“添加确定性机器人”调整为：

- 机器人档案选择器
- 根据档案初始化、但允许编辑的昵称
- 明确的“确定性机器人”选项
- 显示档案是否可用
- 对不可用状态给出具体原因：供应商禁用、凭证缺失、模型禁用或档案禁用

机器人加入后：

- 公共名单只显示机器人标记和公开档案名。
- 主持人可看到该机器人选用的模型配置。
- 只有大厅阶段允许更换档案。
- 对局开始后锁定档案 revision，编辑管理配置不热切换当前对局。
- 档案丢失或凭证不可用时按快照策略回退到确定性机器人。

## 13. 测试矩阵

### 13.1 Shared

- 所有 AI CRUD Schema 严格拒绝未知字段。
- 写入 DTO 和读取 DTO 分离，读取类型不存在 `apiKey`。
- 人类、确定性机器人和 LLM 机器人字段组合保持一致。
- `BotIntent` 继续拒绝 actor、未知动作和非法载荷。
- 旧 `host:add-bot` 确定性载荷继续兼容。

### 13.2 持久化与密钥

- Provider、Model、BotProfile CRUD。
- 重名、无效外键、禁用和被引用删除。
- 密钥替换事务性。
- SQLite 中不存在明文哨兵 API Key。
- 没有主密钥时拒绝持久化凭证。
- v1、v2 快照恢复，v3 快照往返。

### 13.3 管理鉴权

- 远程地址拒绝。
- 缺少、错误和过期 bearer 拒绝。
- 伪造 Origin、Referer 和代理地址拒绝。
- 本机合法主机请求允许。
- 所有响应和日志不包含哨兵 API Key。

### 13.4 供应商适配器

- 正常结构化响应。
- Markdown 包裹、畸形 JSON、未知动作和多余 actor 拒绝。
- 401、404、429、5xx、DNS/TLS 和超时分类。
- AbortSignal 真正终止请求。
- 不安全重定向不携带 Authorization。

### 13.5 编排

- 每个座位只有一个在途请求。
- revision 变化拒绝旧结果。
- 同一 decision key 不重复调用。
- 暂停、阶段切换、座位移除和关闭取消请求。
- 回退顺序和循环检测。
- 预算预留、结算、并发争用和耗尽。
- 强制阶段最终不会因模型失败而死锁。

### 13.6 安全

- 聊天要求泄露 API Key 或系统提示词。
- 聊天伪造系统消息、JSON 指令或其他玩家身份。
- 模型输出非法目标、越权频道和超长发言。
- 狼人私聊不会进入好人机器人的上下文。
- 主持人和玩家视图不存在供应商凭证。

### 13.7 Web 和 E2E

- 显式路由和本机访问限制。
- Provider、Model、BotProfile 完整管理流程。
- 密钥输入保存后不回显。
- 连接测试状态和错误分类。
- 大厅选择不同档案创建多个机器人。
- 人类、确定性机器人和 LLM 机器人混合完成一局。
- 模拟模型超时后确定性回退完成对局。
- 页面刷新和服务重启后配置、座位与回退策略恢复。
- 桌面和移动视口无布局重叠。

## 14. 分阶段交付

### 阶段 0：设计和威胁模型

交付：

- 本路线文档。
- 安全边界、密钥生命周期和 SSRF 策略。
- Shared DTO 草案和数据库迁移设计。

验收：

- 供应商、模型、档案和座位职责不重叠。
- API Key 不进入任何公共类型或房间快照。

### 阶段 1：共享协议和数据库基础

交付：

- `packages/shared/src/ai.ts`
- 严格 CRUD Schema 和脱敏 View。
- `BotKind` 与机器人配置判别联合。
- 统一 SQLite 迁移和 AI 配置仓储。
- `SecretBox` 接口及 AES-GCM 实现。

验收：

- Shared、Store 和旧快照测试通过。
- 数据库中查不到明文测试密钥。

### 阶段 2：受保护的管理 API

交付：

- 集中的 loopback/Origin/bearer 鉴权。
- Provider、Model、BotProfile CRUD。
- 脱敏响应和安全日志。

验收：

- 本机合法请求通过。
- 所有远程、伪造和缺少令牌的请求拒绝。
- 哨兵密钥泄漏扫描通过。

### 阶段 3：供应商连接

交付：

- `ModelProvider` 和 `ProviderRegistry`。
- OpenAI-compatible HTTP 适配器。
- 供应商和模型连接测试。
- 超时、错误分类和取消。

验收：

- 使用模拟服务完成结构化响应和全部失败场景。
- 不依赖真实付费 API 执行自动化测试。

### 阶段 4：LLM 决策

交付：

- `decision-gate.ts`
- `prompt-builder.ts`
- `LlmBotAdapter`
- 结构化决策转换。
- 重试、回退、熔断和预算。

验收：

- 不需要行动的 revision 不调用模型。
- 私密视图隔离、过期拒绝和强制动作回退测试通过。

### 阶段 5：AI 管理页面

交付：

- 显式路由和共享 Host Shell。
- 服务连接、模型和机器人档案页面。
- 密钥遮罩、连接测试和独立表单状态。

验收：

- 桌面和移动组件测试通过。
- DOM、网络响应和错误消息中不存在已保存密钥。

### 阶段 6：大厅档案分配

交付：

- 机器人档案选择器。
- LLM 座位、确定性座位和不可用原因。
- 档案 revision 锁定及快照恢复。

验收：

- 不同机器人可以选择不同模型和人格。
- 对局中配置变化不影响已经锁定的机器人。
- 配置缺失时自动回退。

### 阶段 7：观测、完整验证和发布

交付：

- 调用次数、延迟、Token 和回退概览。
- 安全测试语料。
- 混合机器人 E2E。
- 架构、产品、规则和部署文档更新。

验收：

- `corepack pnpm check:all` 通过。
- Windows 主机与至少两台局域网设备完成人工验收。
- 使用至少两个不同模型配置完成一局。

## 15. 子智能体协作方案

每轮开发保持写入范围互斥：

1. Shared 工作者负责 `packages/shared/src/ai.ts`、机器人领域类型和 Shared 测试。
2. 存储与安全工作者负责迁移、AI Store、SecretBox、鉴权和对应服务端测试。
3. 供应商与运行时工作者负责 `apps/server/src/ai/providers/`、决策门控、LLM Adapter 和编排测试。
4. Web 工作者负责显式路由、Host Shell、AI 管理页面及组件测试。
5. 大厅工作者负责机器人档案选择、Socket 事件和快照兼容。
6. 验证工作者最后执行泄漏审计、E2E、构建和文档一致性检查。

依赖顺序：

```text
Shared
  -> Store + Security
  -> Admin API + Provider
  -> LLM Runtime
  -> Management UI
  -> Lobby Assignment
  -> Security/E2E/Release
```

只有 Shared 与数据库迁移稳定后才并行启动服务端 API 和 Web 只读页面；涉及 `room.ts`、`socket.ts`、`HostScreen.tsx` 的任务分轮执行，避免多个工作者同时修改核心文件。

## 16. 完成定义

目标完成必须同时满足：

- 可管理多个供应商、模型和机器人档案。
- 每个机器人可选择不同档案和模型。
- 确定性机器人保持兼容。
- LLM 只读取自身授权视图。
- 所有动作通过现有 `BotIntent` 和房间规则。
- 密钥不出现在数据库明文、Socket、快照、日志、DOM 或错误响应。
- 超时、失败、预算耗尽和配置缺失不会卡死游戏。
- 自动化测试和生产构建全部通过。
- 文档明确真实局域网和真实模型的人工验收结果。

## 17. 当前实现状态（2026-07-19）

已完成并由自动化验证覆盖：

- Shared AI Provider、Model Profile、Bot Profile 与 LLM 座位协议。
- SQLite 配置持久化、AES-GCM 凭证保护和本机管理 API。
- OpenAI-compatible Chat 供应商、错误归一化和连接测试。
- `decision-gate.ts`、`prompt-builder.ts`、预算账本和 `LlmBotAdapter`。
- LLM Adapter 通过 `BotManager` 接收自身 `PlayerLobbyView`，所有输出继续经过 `BotIntent` 与房间规则执行器。
- 模型配置缺失、供应商不可用、无效结果、请求失败或预算不足时使用确定性回退，不暂停阶段时钟。
- 主持人大厅可加载可用机器人档案，为不同座位选择确定性或 LLM 机器人，并自动采用档案默认昵称。
- LLM 座位档案 ID 已包含在版本 3 快照中；旧版本快照恢复保持兼容。
- `corepack pnpm check:all` 已在 2026-07-19 通过，包括 TypeScript、252 项 Vitest、生产构建和 4 项 Playwright 工作流。

仍需部署者人工完成的外部验收：

- 在真实 Windows 主机设置 `AI_MASTER_KEY` 并配置实际供应商凭证。
- 使用至少两个真实模型配置完成一局混合对局。
- 使用至少两台局域网移动设备确认大厅、对局和重连体验。

这些人工项目依赖部署环境和付费/本地模型服务，不作为仓库自动化测试的前置条件。
