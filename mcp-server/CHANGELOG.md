## [1.1.1] - 2026-03-19

### 变更

- 桥接客户端心跳超时日志消息不再附加客户端 ID，仅显示「桥接客户端心跳超时」。
- 系统日志字段开关区域默认隐藏；在级别/来源下拉列表右侧新增「字段」切换按钮，点击展开或收起字段开关区域。
- 系统日志「客户端已连接」类事件现在正确显示客户端 ID 与活动客户端 ID，不再全部显示为「无」。
- 多客户端场景下，每条连接/断开日志的「客户端ID」字段显示触发本次变化的具体客户端（新接入或刚离线的那个），「活动客户端ID」字段始终显示当前活动客户端。
- 调试控制[开发者]卡片改为可折叠，默认折叠。
- 修复调试控制卡片初始折叠状态未生效的问题（`debugSwitch` 缺少 `enableDebugControlCard` 字段导致始终展开）。
- 侧边栏所有可折叠卡片（桥接配置、AI 指令、系统日志、连接列表、调试控制）的折叠/展开状态现在通过 `vscode.setState` 持久化，重新打开侧边栏后自动恢复上次状态。

---

## [1.1.0] - 2026-03-18

### 新增

- 侧边栏底部新增「打开 EDA 时关闭侧边栏」开关按钮，打开后点击「打开嘉立创 EDA」时自动收起 VS Code 侧边栏。
- VS Code 扩展设置新增「常规」配置组，包含 `jlcMcpServer.closeSidebarOnOpenEditor` 设置项（默认关闭）；侧边栏开关与此设置双向同步。

### 变更

- `jlceda_api_invoke` 工具的 `args` 参数类型由对象改为数组，调用时直接传参数列表；无入参时传空数组 `[]`。
- 移除历史兼容格式（`positionalArgs` 包装对象、`namedArgs`、`parameterOrder`），格式收紧为单一数组。
- 指令新增器件布局规范（强制执行）：要求所有器件必须放置在原理图红框内的中间区域，禁止摆放到边角；放置前先调用 `getCurrentSchematicPageInfo()` 获取页面尺寸，以图页中心为基准规划布局坐标；规范器件间距、信号流向排列和 NetFlag 对齐方式。
- 指令新增连线完整性要求（强制执行）：放置全部器件后必须完成所有功能引脚的电气连接，禁止留悬空引脚；明确三种连线策略（显式导线段、NetFlag + 短导线、NetLabel 复用网络）并要求完成连线自检。
- 指令更新"放置元件到原理图"执行范式，增加页面尺寸获取步骤和器件坐标规划步骤。
- 指令新增"原理图功能性审查"执行范式：明确用户说"检查原理图"时的默认意图是功能性审查（电路用途分析、器件选型合理性、引脚连接正确性、电源网络完整性、信号路径完整性、电路能否正常工作），而非 ERC/DRC 规则检查；给出标准六步执行流程并要求输出结构化审查报告。
- 指令新增"原理图检查意图说明"章节：只有用户明确说"跑一下 ERC"、"检查有没有 ERC 报错"、"做一下 DRC"时，才调用 sch_Drc.check / pcb_Drc.check。

---

## [1.0.0] - 2026-03-16

### 当前功能

**双宿主支持**

- 在 VS Code 中通过 `McpServerDefinitionProvider` 向 Copilot 暴露 MCP 服务定义，工具自动可发现。
- 在 Cursor 中通过 `cursor.mcp` 扩展 API 注册 stdio MCP 服务，配置变更后自动重新注册。
- 宿主类型通过 `vscode.env.appName` 自动识别，无需手动切换。

**侧边栏 UI（ActivityBar）**

- 在 VS Code 活动栏注册「嘉立创 EDA MCP」侧边栏视图，展示本地服务面板。
- 每 1 秒轮询运行时状态快照文件，实时显示服务运行状态（启动中 / 运行中 / 已停止 / 错误）。
- 实时展示桥接连接状态（等待连接 / 已连接 / 不可用）及已连接客户端列表（区分活动与待命角色）。
- 快照文件过期检测：若进程心跳中断超过阈值，自动将状态标记为已停止。

**MCP stdio 运行时**

- 以独立 Node.js 子进程（stdio 模式）运行 MCP 服务，与 VS Code/Cursor 宿主进程隔离。
- 运行时每 1 秒写入状态心跳快照文件，供扩展侧边栏轮询读取。
- 运行时入口通过命令行参数接收 host、port、状态文件路径、扩展版本号、调试开关及 AI 指令（Base64 编码）。

**桥接 WebSocket 服务端**

- 启动本地 WebSocket 服务，监听指定 host/port（默认 `127.0.0.1:8765`），路径为 `/bridge/ws`。
- 支持多客户端同时接入；通过仲裁中心裁决活动/待命角色（首个接入的客户端为活动角色）。
- 客户端 TTL 检测（8 秒无心跳则判定超时并清理），维护心跳回包机制。
- 任务仅下发给活动客户端并携带租约号，客户端回传结果时校验租约防止结果错配。
- 等待活动客户端的请求支持超时控制，超时后返回结构化超时错误描述。

**三个 MCP 工具**

- `jlceda_api_search`：转发 API 检索请求到 EDA 连接器，参数支持 `query`（关键词）、`scope`（`callable` / `type` / `all`）、`owner`（名称空间过滤）、`limit`（1–50，默认 10）。
- `jlceda_api_invoke`：转发 API 调用请求到 EDA 连接器，参数支持 `apiFullName`、`args`（兼容 positionalArgs / namedArgs 格式）、`timeoutMs`（1000–120000ms，默认 15000ms）。
- `jlceda_context_get`：转发上下文查询请求到 EDA 连接器，参数支持 `scope` 和 `timeoutMs`。

**JSON-RPC 2.0 处理**

- 实现 `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 四个标准 MCP 方法。
- `initialize` 响应携带内置 AI 助手指令（可由用户自定义覆盖）、协议版本 `2024-11-05` 和服务版本号。
- 工具调用结果同时返回 `content`（文本）和 `structuredContent`（原始对象）两种格式。

**服务配置**

- 桥接监听 IP（`jlcMcpServer.host`，默认 `127.0.0.1`）和端口（`jlcMcpServer.port`，默认 `8765`）通过 VS Code 配置持久化。
- 配置变更后自动触发 MCP 服务定义刷新，AI 工具客户端无需手动重连。

**AI 助手指令**

- 内置嘉立创 EDA 操作系统指令，通过 `initialize` 响应下发给 AI 助手。
- 支持用户自定义指令（`jlcMcpServer.agentInstructions`），设置后覆盖内置指令，保存后重连即生效。

**开发者模式**

- `jlcMcpServer.enableSystemLog`：启用系统日志选项卡，开启后侧边栏展示来自 EDA 连接器的实时日志流。
- `jlcMcpServer.enableConnectionList`：启用连接列表选项卡，开启后展示桥接连接信息日志。
- `jlcMcpServer.enableDebugControlCard`：启用调试控制卡片，可在侧边栏手动触发或停止 stdio 进程（仅用于调试）。
