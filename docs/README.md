# JLCEDA MCP

JLCEDA MCP 是一套面向嘉立创 EDA 的本地 MCP 双扩展方案，由 mcp-hub 和 mcp-bridge 组成。接入后，你可以直接在 Copilot、Cursor Chat 中检查原理图、分析电路、辅助设计电路方案，并让 AI 在嘉立创 EDA 中完成相关操作。

## 文档入口

- 实机体验产品复盘与批量恢复改进：`docs/mcp-product-review-2026-09-06.md`

- 项目总览：`docs/README.md`
- 服务改进记录：`docs/service-improvement-spec-2026-04-20.md`
- 前沿痛点与待解问题：`docs/frontier-painpoints-spec-2026-05-11.md`
- 核心痛点开发计划：`docs/core-painpoints-development-plan-2026-05-11.md`
- 重构测试基线：`docs/refactor-test-baseline.md`
- 仓库协作规范：`../AGENTS.md`

## 整体链路

```
嘉立创 EDA（mcp-bridge）
    ↕ WebSocket 桥接
VS Code / Cursor（mcp-hub）
    ↕ stdio/http MCP 协议
MCP 客户端（Copilot / Cursor Chat / Claude Code / Codex 等）
```

- **mcp-bridge**：EDA 侧扩展，建立到 mcp-hub 的 WebSocket 连接，负责让 AI 在嘉立创 EDA 中读取当前图纸信息并执行相关操作。
- **mcp-hub**：VS Code/Cursor 侧扩展，通过 stdio/http MCP 协议将多项 MCP 工具能力暴露给 AI 助手，并托管桥接 WebSocket 服务接收 Bridge 连接。

## 可用工具

**基础工具**

| 工具                   | 说明                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `schematic_read`   | 读取当前原理图的完整电路语义快照，返回器件列表、引脚→网络名映射、网络连接关系与 DRC 检查结果 |
| `schematic_review` | 读取全工程所有原理图页面的网表文件，覆盖多页电路，适合全局审查、BOM 核查与跨页信号追踪       |
| `pcb_snapshot`     | 读取当前 PCB 页面归一化后的几何关系快照，返回图层、走线、过孔、覆铜、fill、region、image、object、实际覆铜填充区域、器件、焊盘与板框信息 |
| `pcb_geometry_analyze` | 分析当前 PCB 的几何关系，返回规范化 `relations`、`features` 与证据字段，支持 loop area proxy 与 trace/object 空间关系等可计算代理量 |
| `component_select` | 返回真实器件候选，由 AI 根据型号、封装及参数选型 |
| `component_place` | 按指定坐标或默认网格执行放置，回读确认并返回批量恢复清单 |
| `pin_net_configure` | 在实际引脚端点创建原生 NET 端口，完成后核对网表与 DRC |

**透传 EDA API 工具（可选）**

在 mcp-hub 侧边栏「功能设置」中开启「暴露透传 EDA API 工具」后，以下工具将额外暴露给 AI 客户端，开关切换后立即生效。适合有进阶需求的用户探索使用。

| 工具           | 说明                                                                |
| ------------ | ------------------------------------------------------------------- |
| `api_index`  | 列出所有可用的 EDA API 模块名称，用于浏览 API 命名空间全貌               |
| `api_search` | 按关键词搜索具体 API 方法及其参数说明，便于 AI 定位所需接口           |
| `eda_context`| 读取当前 EDA 页面的上下文信息，包括活动页类型与当前工程基本状态       |
| `api_invoke` | 直接调用任意 EDA API 并将结果透传给 AI，适用于核心工具未覆盖的定制化任务           |

## 交互使用说明

1. 先调用 `bridge_status` 确认在线页面，再由 AI 检索真实器件并选择型号。
2. `component_place` 支持 `dryRun`；预览不等同于实际几何检查通过。
3. 放置或连网中途失败时按 `remainingIndices` 回读并续做，不重放整批。
4. 电源/地可通过 `pin_net_configure` 配置网络；标签创建成功后仍需 `schematic_review` 核对网表与 DRC。

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> 初次安装时，先确认 VS Code/Cursor 与嘉立创 EDA 两侧扩展都已安装，再检查聊天工具的 MCP 服务配置是否正确。

### mcp-hub（VS Code / Cursor）

**从扩展商店安装（推荐）：**

- VS Code：[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-hub)
- Cursor（Open VSX）：[open-vsx.org](https://open-vsx.org/extension/chengbin/jlceda-mcp-hub)

### mcp-bridge（嘉立创 EDA）

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP Bridge"并安装。

## 注意事项

1. 两个扩展必须同时安装，单独安装任意一侧均无法使用在线调用功能。
2. 如果修改了服务端监听端口，需在 EDA Bridge 设置页同步更新桥接地址。
3. 首次发起聊天后服务才会启动，且仅在原理图或 PCB 页面可连接。
4. 多页面同时连接时，只有活动角色页面执行任务，其余页面处于待命状态，属正常现象。若当前 EDA 页面与活动客户端不一致，请关闭其他 EDA 页面后刷新当前页。
5. 状态异常时，先重载 VS Code/Cursor，再重启嘉立创 EDA。

---

## 开发说明

以下内容面向开发者与维护者。

### 仓库结构

```text
JLCEDA-MCP/
├─ mcp-hub/         VS Code/Cursor 扩展与 stdio MCP 运行时
├─ mcp-bridge/   嘉立创 EDA 扩展与桥接 WebSocket 客户端
├─ build/           构建产物输出目录（VSIX / EEXT）
└─ tool/            离线文档与资源生成辅助脚本
```

### 开发环境要求

- Node.js 20+
- npm
- VS Code 1.105+（mcp-hub 开发与调试）
- 嘉立创 EDA 专业版（mcp-bridge 安装与联调）

### 构建

**构建 mcp-hub：**

```bash
cd mcp-hub
npm install
npm run build
```

产物：`build/jlceda-mcp-hub.vsix`

**构建 mcp-bridge：**

```bash
cd mcp-bridge
npm install
npm run build
```

产物：`build/jlceda-mcp-bridge.eext`

### 本地联调流程

1. 在 VS Code 或 Cursor 中安装 mcp-hub 扩展。
2. 在侧边栏确认桥接监听地址，默认为 `ws://127.0.0.1:8765/bridge/ws`。
3. 在嘉立创 EDA 中安装 mcp-bridge，写入相同的桥接地址。
4. 打开 EDA 工程，确认 Bridge 已建立桥接连接。
5. 在聊天客户端调用工具，并观察侧边栏状态、连接列表与日志。

### 开发约定

1. 新增或变更工具定义时，同步更新 `mcp-hub/resources/mcp-tool-definitions.json`、对应 README 与 CHANGELOG。
2. 新增或变更桥接任务路径时，必须同时修改 mcp-hub 与 mcp-bridge 两端处理逻辑。
3. 调整桥接地址、端口、协议字段或角色模型时，同步更新相关 README 与 CHANGELOG。
4. 发布前执行两端构建，确认 VSIX 与 EEXT 均可成功生成。

### 相关文档

- [mcp-hub/README.md](../mcp-hub/README.md)
- [mcp-bridge/README.md](../mcp-bridge/README.md)
- [mcp-hub/CHANGELOG.md](../mcp-hub/CHANGELOG.md)
- [mcp-bridge/CHANGELOG.md](../mcp-bridge/CHANGELOG.md)

## 许可证

本项目采用 [Apache License 2.0](../LICENSE) 许可证。
