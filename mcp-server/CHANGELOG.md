## [1.0.1] - 2026-03-18

### 变更

- `jlceda_api_invoke` 工具的 `args` 参数类型由对象改为数组，调用时直接传参数列表；无入参时传空数组 `[]`。
- 移除历史兼容格式（`positionalArgs` 包装对象、`namedArgs`、`parameterOrder`），格式收紧为单一数组。

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
