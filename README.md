# JLCEDA MCP

JLCEDA MCP 是一套面向嘉立创 EDA 的本地 MCP 双扩展方案，由 mcp-server 和 mcp-connector 组成。接入后，你可以直接在 Copilot、Cursor Chat、Claude Code 等 AI 助手中检查原理图、分析电路、辅助设计电路方案，并让 AI 在嘉立创 EDA 中完成相关操作。

## 整体链路

```
嘉立创 EDA（mcp-connector）
    ↕ WebSocket 桥接
VS Code / Cursor（mcp-server）
    ↕ stdio MCP 协议
AI 大模型（Copilot / Claude / Gemini 等）
```

- **mcp-connector**：EDA 侧扩展，建立到 mcp-server 的 WebSocket 连接，负责让 AI 在嘉立创 EDA 中读取当前图纸信息并执行相关操作。
- **mcp-server**：VS Code/Cursor 侧扩展，通过 stdio 将多项 MCP 工具能力暴露给 AI 助手，并托管桥接 WebSocket 服务接收连接器连接。

## 可用工具

| 工具 | 说明 |
|------|------|
| `jlceda_api_search` | 检索嘉立创 EDA API 文档，支持按名称、范围、命名空间过滤，最多返回 50 条 |
| `jlceda_api_invoke` | 请求嘉立创 EDA 执行指定 API，并返回执行结果，支持自定义超时（1000–120000 ms） |
| `jlceda_context_get` | 获取当前 EDA 运行状态快照，包括工程、页面、选区等信息 |
| `jlceda_schematic_check` | 对当前原理图执行完整检查，返回 ERC 结果和精简网表，便于分析电路问题 |

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> VS Code 内置 Copilot 和 Cursor 内置 Chat 在安装服务端扩展后会自动配置 MCP 服务；其他聊天工具如 Claude Code、Codex，需要手动配置 MCP 服务。

> 初次安装时，先确认 VS Code/Cursor 与嘉立创 EDA 两侧扩展都已安装，再检查聊天工具的 MCP 服务配置是否正确。

### mcp-server（VS Code / Cursor）

**从扩展商店安装（推荐）：**

- VS Code：[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-server)
- Cursor（Open VSX）：[open-vsx.org](https://open-vsx.org/extension/chengbin/jlceda-mcp-server)

### mcp-connector（嘉立创 EDA）

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP连接器"并安装。

## 注意事项

1. 两个扩展必须同时安装，单独安装任意一侧均无法使用在线调用功能。
2. 如果修改了服务端监听端口，需在 EDA 连接器设置页同步更新桥接地址。
3. 首次发起聊天后服务才会启动，且仅在原理图或 PCB 页面可连接。
4. 多页面同时连接时，只有活动角色页面执行任务，其余页面处于待命状态，属正常现象。若当前 EDA 页面与活动客户端不一致，请关闭其他 EDA 页面后刷新当前页。
5. 状态异常时，先重载 VS Code/Cursor，再重启嘉立创 EDA。

---

## 开发说明

以下内容面向开发者与维护者。

### 仓库结构

```text
JLCEDA-MCP/
├─ mcp-server/      VS Code/Cursor 扩展与 stdio MCP 运行时
├─ mcp-connector/   嘉立创 EDA 扩展与桥接 WebSocket 客户端
├─ build/           构建产物输出目录（VSIX / EEXT）
└─ tool/            离线文档与资源生成辅助脚本
```

### 开发环境要求

- Node.js 20+
- npm
- VS Code 1.105+（mcp-server 开发与调试）
- 嘉立创 EDA 专业版（mcp-connector 安装与联调）

### 构建

**构建 mcp-server：**

```bash
cd mcp-server
npm install
npm run build
```

产物：`build/jlceda-mcp-server.vsix`

**构建 mcp-connector：**

```bash
cd mcp-connector
npm install
npm run build
```

产物：`build/jlceda-mcp-connector.eext`

### 本地联调流程

1. 在 VS Code 或 Cursor 中安装 mcp-server 扩展。
2. 在侧边栏确认桥接监听地址，默认为 `ws://127.0.0.1:8765/bridge/ws`。
3. 在嘉立创 EDA 中安装 mcp-connector，写入相同的桥接地址。
4. 打开 EDA 工程，确认连接器已建立桥接连接。
5. 在聊天客户端调用工具，并观察侧边栏状态、连接列表与日志。

### 开发约定

1. 新增或变更工具定义时，同步更新 `mcp-server/resources/jlceda-mcp-tool-definitions.json`、对应 README 与 CHANGELOG。
2. 新增或变更桥接任务路径时，必须同时修改 mcp-server 与 mcp-connector 两端处理逻辑。
3. 调整桥接地址、端口、协议字段或角色模型时，同步更新相关 README 与 CHANGELOG。
4. 发布前执行两端构建，确认 VSIX 与 EEXT 均可成功生成。

### 相关文档

- [mcp-server/README.md](./mcp-server/README.md)
- [mcp-connector/README.md](./mcp-connector/README.md)
- [mcp-server/CHANGELOG.md](./mcp-server/CHANGELOG.md)
- [mcp-connector/CHANGELOG.md](./mcp-connector/CHANGELOG.md)

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。
