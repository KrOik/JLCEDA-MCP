# JLCEDA MCP 前沿痛点与待解问题 Spec

**日期**: 2026-05-11  
**范围**: `mcp-hub` + `mcp-bridge` + shared MCP/EDA 工具契约  
**目标**: 把“仍像玩具”的主观感受转译为可验证、可排期、可回归的产品与架构缺口。  
**非目标**: 本文不承诺已有功能可完成未实现能力；不以 mock、伪截图、装饰性图表或纯叙述替代真实验收。

## 1. Assumptions And Trade-offs

### 1.1 Assumptions

- JLCEDA MCP 的目标用户不是闲聊用户，而是需要让 AI 在真实原理图/PCB 上完成审查、定位、解释、修改建议与半自动操作的硬件工程师。
- 当前项目的 source of truth 是仓库源码、README、测试结果、MCP 工具定义和真实运行工具返回。
- 外部资料只用于识别 MCP 与 AI+EDA 的前沿方向，不用于虚构 JLCEDA 当前能力。
- “前沿痛点”必须落成可验收 backlog，而不是泛泛的行业趋势描述。

### 1.2 Trade-offs

- 优先解决高频、低风险、能形成 end-to-end closed loop 的任务级能力，而不是继续扩展底层 API 数量。
- 对写入类能力采用 preview / evidence / explicit apply / rollback 四段式，不追求一次性全自动修改。
- 对 AI 判断类能力只输出 evidence-bound finding，不输出无法追溯的“专家结论”。
- 对外部协议更新采用兼容式演进，不为追逐最新 MCP 字段破坏现有 Copilot/Cursor/Claude Code/Codex 接入。

## 2. Evidence Chain

### 2.1 Repo-local Evidence

- Public README 暴露的基础工具仍集中在读取、快照、定位、选型、放置与透传 API：`README.md:18`。
- Hub 默认基础工具只有 `schematic_read`、`schematic_locate`、`schematic_review`、`pcb_snapshot`、`pcb_geometry_analyze`、`pcb_constraint_snapshot`、`component_select`、`component_place`：`mcp-hub/src/server/mcp/tool-definition-registry.ts:5`。
- Raw API 工具需要显式打开，且仍是 API 索引/搜索/调用/上下文四件套：`mcp-hub/src/server/mcp/tool-definition-registry.ts:16`。
- Bridge 路由表仍是原子 handler 映射，没有任务编排层：`mcp-bridge/src/runtime/bridge-runtime.ts:43`。
- HTTP `/health` 只返回 `ok`，无法诊断 bridge、页面、工具开关、活动文档与接错端点：`mcp-hub/src/server/core/transports/http-server.ts:63`。
- PCB component 快照通过全量 `getAll()` 读取后再抽取 designator/name/pads，尚无 designator/net 直达任务接口：`mcp-bridge/src/plugins/pcb-geometry-engine/plugin.ts:1148`。
- 既有改进 spec 已识别 designator 直达、任务级 summary、review API 与诊断缺口：`docs/service-improvement-spec-2026-04-20.md:20`。
- 当前测试基线健康：2026-05-11 本地执行 `mcp-hub npm test` 为 11 files / 49 tests passed，`npm run typecheck` 通过；`mcp-bridge npm test` 为 16 files / 85 tests passed，`npm run typecheck` 通过。

### 2.2 Live Runtime Evidence

- `eda_context(scope="diagnostic")` 在 2026-05-11 返回真实工程 `plusata`、当前 schematic page `plustat`、`documentType: 1`，证明 bridge live path 可用。
- `schematic_locate(query="U1")` 可精确返回 `U1`，证明原理图定位工具已能处理部分工程查询。
- `schematic_locate(query="U16")` 在当前工程返回 fuzzy 候选 `U1` 且 `exactMatchCount: 0`，证明“直达查询”仍需要 exact/none/fuzzy contract，不能让 agent 把 fuzzy 当事实。
- 在当前 schematic 页面调用 `pcb_snapshot` 返回“当前未检测到活动 PCB 页面”，错误可读，但缺少“如何切换/当前可用工具/下一步”的诊断级辅助。

### 2.3 External Frontier Evidence

- MCP 2025-06-18 specification 明确引入 authorization framework、structured tool output、resource links、elicitation 等能力；这说明现代 MCP 服务应支持更强的安全、结构化结果与交互式补参，而不只是 JSON-RPC 透传。
- MCP 2025-11-25 latest stable 继续演进 tool output 与 resource link 元数据、OAuth resource metadata discovery、tool title annotations、experimental task management、URL context 等；这说明长任务、可审计资源与工具发现体验正在成为 MCP server 的竞争面。
- MCP 2026 tool annotations 讨论把工具风险表达成共享 vocabulary，但也强调 annotation 只是 hint，不能替代服务端策略；这直接影响 `api_invoke`、写入工具和 destructive action gating 的设计。
- MCP security best practices 明确关注 confused deputy、token passthrough、session hijacking、DNS rebinding 与 input validation；JLCEDA MCP 未来的写入/透传能力必须按安全边界设计，而不能只靠“本机服务”假设。
- AI+EDA 论文与综述趋势集中在 LLM-assisted design generation、verification/debug、EDA tool orchestration、benchmarking、domain adaptation、agent workflow；反复出现的缺口是 hallucination、缺少可执行验证、工具调用脆弱、工程上下文过长、从建议到 layout/schematic action 的闭环不足。

## 3. Problem Statement

当前 JLCEDA MCP 的关键问题不是“没有工具”，而是：

> 它把 EDA 数据与底层 API 暴露给 agent，但没有把硬件工程师的真实任务稳定封装为可诊断、可追溯、可回归的 end-to-end workflow。

因此用户会感到：

- 能读，但难以快速得到工程摘要。
- 能查，但 exact/fuzzy/no-match 边界不强。
- 能透传 API，但 agent 仍要猜接口、拼路径、承担安全风险。
- 能选型/放置，但不能从“设计意图”闭环到“原理图连接/PCB 布局/规则检查/人工确认”。
- 能跑单个工具，但不能像专业 EDA assistant 一样维护任务状态、证据链、变更计划和回滚点。

## 4. Frontier Painpoints And Required Capabilities

### P0. Diagnosis Is Too Shallow

**Evidence**

- `/health` only returns `ok`: `mcp-hub/src/server/core/transports/http-server.ts:63`。
- 既有 runtime status 文件包含 bridge client count、logs、version mismatch 等字段，但没有作为 MCP/HTTP 诊断能力对用户暴露：`mcp-hub/src/server/runtime.ts:269`。
- Live `pcb_snapshot` 在 schematic 页面失败时只说明当前不是 PCB，没有给出当前文档、可用替代工具、下一步操作。

**Impact**

- 新用户很容易把 EDA bridge WebSocket、HTTP MCP endpoint、health endpoint 混用。
- Agent 排障需要多轮环境探测，浪费上下文和用户耐心。
- 失败后不能自动形成“下一步”。

**Required capability**

- 新增 `eda_diagnose` MCP tool 与 HTTP `/diagnose` endpoint。
- 返回 hub server、bridge connection、active client、version mismatch、current document type、current schematic/PCB identifiers、enabled tool surface、recommended MCP URL、last bridge error、next recommended action。
- 错误消息引用 `diagnosticCode`，例如 `NO_ACTIVE_PCB_PAGE`、`NO_BRIDGE_CLIENT`、`WRONG_ENDPOINT`、`RAW_API_DISABLED`。

**Acceptance criteria**

- 断开 EDA bridge 时，`eda_diagnose` 单次调用返回 “bridge disconnected + expected ws URL + MCP client URL”。
- 当前为 schematic 时调用 PCB 工具失败，错误响应包含 `diagnosticCode` 与 `suggestedTools: ["schematic_locate", "schematic_read", "eda_context"]`。
- README 首页 5 分钟内可完成接入验证：health、diagnose、tools/list、live context 四步均有示例。

### P1. Object Lookup Is Not Strict Enough

**Evidence**

- `schematic_locate("U1")` 能 exact match。
- `schematic_locate("U16")` 在当前工程返回 `U1` fuzzy match，`exactMatchCount: 0`。
- PCB component snapshot 读取包含 designator/name/pads，但没有 first-class designator lookup：`mcp-bridge/src/plugins/pcb-geometry-engine/plugin.ts:1148`。

**Impact**

- Agent 可能把 fuzzy 候选误认为目标器件，导致错误分析或错误操作。
- 工程师常以 `U16`、`R8`、`TP1`、`VBUS`、`USB_DP` 为入口，但当前仍要靠全量快照/筛选/猜测。
- 原理图和 PCB 的同一对象没有统一 identity mapping。

**Required capability**

- 新增 `design_object_lookup`，支持 `componentDesignators`、`nets`、`pins`、`scope: schematic|pcb|both`、`matchMode: exact|prefix|fuzzy`。
- 默认 `matchMode` 必须为 `exact`；fuzzy 结果只能放在 `suggestions`，不得进入 `matches`。
- 返回 schematic component、pin-net map、PCB footprint/location/layer/pads、source page/board、confidence 与 evidence object IDs。

**Acceptance criteria**

- 查询不存在的 `U16` 返回 `status: no_exact_match`，且 suggestions 明确标为非事实。
- 查询存在的 `U1` 返回 exact match、pins、nets、source page、component instance id。
- 当 PCB 页面可用时，查询 `U1` 同时返回 schematic 与 PCB 两侧证据；不可用时返回 partial result 与 clear gap。

### P2. Snapshots Are Facts, Not Task Answers

**Evidence**

- `pcb_snapshot` 和 `pcb_geometry_analyze` 已返回丰富事实层数据：README 工具说明见 `README.md:26`。
- `pcb_constraint_snapshot` 已返回第二层约束上下文：`README.md:28`。
- 但工具名和返回形态仍偏事实快照，没有“问题导向”的 review result。

**Impact**

- Agent 需要自己从大量 geometry/constraint facts 中综合结论，容易 hallucinate。
- 用户问“USB 走线有没有明显问题”“这个 LDO 周围布局是否合理”时，工具没有任务入口。
- 工程质量判断缺少统一 severity、evidence、confidence、recommended action schema。

**Required capability**

- 新增 `engineering_review`，以 checklist profile 组织任务：`power_domain`、`usb_basic`、`crystal_layout`、`high_impedance_input`、`decoupling_basic`、`net_route_basic`、`schematic_connectivity`。
- 每个 finding 必须包含 `ruleId`、`severity`、`claim`、`evidenceRefs`、`uncertainty`、`requiredManualCheck`、`recommendedAction`。
- Review 工具只做 evidence-bound finding，不直接声称完成 SI/PI/EMC 专业认证。

**Acceptance criteria**

- 对不存在 PCB 上下文的 review 返回 `blocked`，列出缺失证据而不是编造结论。
- 对指定 net review，最多 3 次内部桥接调用生成结构化 findings。
- 每个 finding 至少绑定一个 schematic/PCB primitive id、net name、rule config 或明确的 evidence gap。

### P3. Write Actions Need Safe Transaction Semantics

**Evidence**

- 当前基础写入能力主要是 `component_place`，且仍是用户引导式放置：`README.md:30`。
- Raw API `api_invoke` 可直接调用 EDA API，但作为进阶透传工具暴露：`README.md:38`。
- MCP security guidance 强调 input validation、least privilege、confused deputy 与 token/session 风险。

**Impact**

- 直接扩大 `api_invoke` 会带来误删、误改、批量破坏项目的风险。
- 没有 preview/diff/apply/rollback，agent 无法安全承担修改任务。
- 用户不会信任“AI 自动改板/改图”。

**Required capability**

- 新增 `change_plan_create`、`change_plan_preview`、`change_plan_apply`、`change_plan_rollback`。
- 所有写入类工具都必须走 `changePlanId`，包含 affected objects、before snapshot、intended API calls、human-readable diff、risk flags。
- 默认只 preview；apply 需要用户明确确认或 sidebar elicitation。

**Acceptance criteria**

- 尝试移动/改网/放置普通器件前，必须先产生 preview，不允许直接 apply。
- Apply 后自动读取受影响对象快照并生成 post-check。
- Rollback 至少支持本工具产生的 change plan；不支持时必须标明 `rollbackUnsupportedReason`。

### P4. Interaction Model Is Too Tool-call Centric

**Evidence**

- 当前交互主要集中在 `component_select` 与 `component_place` 的侧边栏流。
- MCP 新规范强调 elicitation、structured output、resource links、progress、completions 与 task management；2026 tool annotation 讨论进一步说明工具风险需要既能被 host/client 理解，也要由 server 强制执行。

**Impact**

- 当工具缺少必要参数时，agent 只能在聊天里问用户，不能在 MCP 层表达“需要你确认/补充”。
- 长时间 PCB 分析、批量器件处理、变更计划应用缺少 progress 与 cancel。
- 输出 JSON 很大时，用户缺少可点击资源、报告和引用对象。

**Required capability**

- 引入统一 interactive task model：`taskId`、`state`、`progress`、`requiredUserInput`、`resources`、`result`。
- 大型结果写入 resource artifact，例如 review report、snapshot excerpt、change plan diff。
- 对支持的客户端使用 MCP elicitation；对不支持的客户端回退到 sidebar + structuredContent。

**Acceptance criteria**

- 长任务每 2 秒或每阶段发送 progress update。
- 用户取消后工具返回 `cancelled`，不会继续 apply 写入。
- Review result 同时提供 structured findings 与 markdown report resource。

### P5. API Discovery Remains Symbol-oriented

**Evidence**

- `api_search` 已有 ranking 改进计划与实现资料：`docs/superpowers/specs/2026-04-21-api-search-layering-design.md:7`。
- 但 raw tools 仍是 `api_index` / `api_search` / `api_invoke`，没有 capability ontology。

**Impact**

- Agent 搜索 API 时仍以关键词猜测，而不是从工程意图映射到安全能力。
- 可写 API、删除 API、项目级 API 与只读 API 缺少统一风险分级。
- 用户无法知道“这个需求是否已有高层工具，不该用 raw API”。

**Required capability**

- 构建 `capability_catalog`：按 task、domain、read/write risk、requires active doc、requires selection、supports preview 分类。
- `api_search` 返回 action category、risk tier、recommended wrapper tool、danger flags。
- `api_invoke` 对高风险 API 默认拒绝，除非来自 approved change plan。

**Acceptance criteria**

- 搜索 `delete schematic page` 时结果标记 destructive risk。
- 搜索 `get U1 pins` 时推荐 `design_object_lookup`，而不是鼓励 raw API。
- `api_invoke` 调用 destructive API 时返回 policy error 和 change-plan guidance。

### P6. Verification Loop Is Missing From User-facing Workflows

**Evidence**

- Repo 已有单元测试与类型检查，说明工程基线可靠。
- 用户级 EDA 任务没有同等的 postcondition verification schema。
- AI+EDA 前沿研究反复强调生成/建议必须配合 compile/simulate/verify/DRC/ERC 等执行证据。

**Impact**

- “AI 已经改好了/审查完了”缺少可复现证据。
- 回归测试不能覆盖真实工程项目行为。
- 用户无法把 MCP 输出纳入硬件设计 review 流程。

**Required capability**

- 每个任务级工具定义 `preconditions`、`postconditions`、`verificationSteps`。
- 写入后自动跑最小 post-check：对象存在、坐标/网络符合预期、DRC/ERC 可读时附摘要。
- 引入 fixture project 或 recorded bridge trace 做 regression。

**Acceptance criteria**

- 每个 P0/P1 工具新增 tests 覆盖 exact/no-match/error 分支。
- 每个写入工具返回 `verification.status: passed|failed|partial|not_run`。
- CI 或本地命令能跑 replay regression，不依赖真实 EDA UI。

### P7. Output Provenance Is Not First-class

**Evidence**

- Dispatcher 统一把结果序列化到 `content` 和 `structuredContent`：`mcp-hub/src/server/mcp/tool-dispatcher.ts:107`。
- 当前工具结果各自携带事实字段，但没有统一 provenance envelope。
- MCP structured output 与 resource link 趋势要求机器可读结果、用户可读资源和引用关系并存。

**Impact**

- Agent 最终回答难以稳定引用“这个结论来自哪个 primitive、哪个 net、哪个规则”。
- 结果被截断或压缩时，证据链容易丢失。
- 难以形成审查报告、变更记录和可回归 artifact。

**Required capability**

- 定义统一 `EvidenceRef`：`kind`、`sourceTool`、`documentUuid`、`pageUuid`、`primitiveId`、`netName`、`fieldPath`、`capturedAt`。
- 所有任务级工具输出都采用 `result + evidence + gaps + resources` envelope。
- 大型证据转 resource artifact，主响应只返回摘要和 links。

**Acceptance criteria**

- `engineering_review` 每条 finding 至少一个 `EvidenceRef` 或一个 explicit gap。
- `design_object_lookup` 每个 match 都能追溯到 schematic/PCB source object。
- 超过大小阈值的 snapshot 自动生成 excerpt resource，而非直接塞满聊天上下文。

## 5. Prioritized Backlog

### Milestone 1: Trust And Diagnosis

1. `eda_diagnose` + `/diagnose`。
2. Strict `design_object_lookup` with exact/no-match/fuzzy separation。
3. Unified diagnostic code schema。
4. README quickstart rewrite around health/diagnose/context/tools。

**Exit criteria**: 新用户能在 5 分钟内证明“服务连通、bridge 活跃、当前页可读、错误可解释”。

### Milestone 2: Task-level Read Intelligence

1. `engineering_review` MVP with `schematic_connectivity` and `net_route_basic` profiles。
2. `EvidenceRef` envelope。
3. Review report resource artifact。
4. Replay tests for no-context, partial-context and happy-path fixtures。

**Exit criteria**: 常见“查器件/查网/基础审查”可在 1 到 3 次工具调用内闭环，并有 evidence-bound output。

### Milestone 3: Safe Write Loop

1. `change_plan_create/preview/apply/rollback` skeleton。
2. Raw API risk tier and destructive-call gate。
3. Component placement integrated into change plan。
4. Post-apply verification schema。

**Exit criteria**: 任何写入都先 preview，apply 后有 post-check，不支持 rollback 时明确说明。

### Milestone 4: Advanced Agentic EDA

1. Interactive task progress/cancel model。
2. MCP elicitation/resource-link progressive support with fallback。
3. Domain-specific review profiles: USB, crystal, decoupling, high impedance, power domain。
4. Capability catalog and wrapper recommendation in `api_search`。

**Exit criteria**: JLCEDA MCP 从“工具集合”演进为“带状态、证据和安全边界的 EDA agent runtime”。

## 6. Open Questions

- JLCEDA extension API 是否提供稳定 undo/transaction primitive？如果没有，rollback 只能通过 before-state replay 做 best effort。
- 是否能可靠获得 schematic component 与 PCB footprint 的 cross-probe identity？如果不能，需要建立 heuristic mapping 并显式标 confidence。
- Cursor/Copilot/Claude Code/Codex 对 MCP elicitation、resource links、progress 的支持程度不同，是否需要 compatibility matrix？
- 是否允许在本地保存设计快照 artifact？如果允许，需要隐私、清理、大小限制和项目隔离策略。
- DRC/ERC API 的可用性、耗时和失败模式需要 live probing，不应在未验证前承诺自动审查完整性。

## 7. Source Notes

### 7.1 MCP Protocol And Security

- MCP 2025-06-18 specification: https://modelcontextprotocol.io/specification/2025-06-18/index
- MCP 2025-06-18 tools and structured output: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP 2025-06-18 elicitation: https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation
- MCP 2025-06-18 progress utility: https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress
- MCP authorization specification: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- MCP 2025-11-25 key changes: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- MCP 2025-11-25 tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP 2025-11-25 tasks: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- MCP 2026 tool annotations risk vocabulary: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/

### 7.2 AI+EDA Research Signals

- ChatEDA: A Large Language Model Powered Autonomous Agent for EDA: https://arxiv.org/abs/2308.10204
- ChipNeMo: Domain-Adapted LLMs for Chip Design: https://arxiv.org/abs/2311.00176
- LLM4EDA: Emerging Progress in Large Language Models for Electronic Design Automation: https://arxiv.org/abs/2401.12224
- A Survey of Research in Large Language Models for Electronic Design Automation: https://arxiv.org/abs/2501.09655
- Automatically Improving LLM-based Verilog Generation using EDA Tool Feedback: https://arxiv.org/abs/2411.11856
- MMCircuitEval: A Comprehensive Multimodal Circuit-Focused Benchmark for Evaluating LLMs: https://arxiv.org/abs/2507.19525

### 7.3 Repo-local Sources

- Current tool surface: `README.md:18`, `mcp-hub/src/data/mcp-tool-definitions.json:1`
- Hub tool allowlist: `mcp-hub/src/server/mcp/tool-definition-registry.ts:5`
- Bridge route map: `mcp-bridge/src/runtime/bridge-runtime.ts:43`
- HTTP health endpoint: `mcp-hub/src/server/core/transports/http-server.ts:63`
- PCB component snapshot reader: `mcp-bridge/src/plugins/pcb-geometry-engine/plugin.ts:1148`
- Prior improvement spec: `docs/service-improvement-spec-2026-04-20.md:20`


