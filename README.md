# JLCEDA MCP

JLCEDA MCP 将 AI agent 与嘉立创 EDA 连接起来。服务可独立于 VS Code 后台运行，多个 MCP 客户端共用一个服务进程；器件选型、坐标放置和引脚 NET 配置由 AI 决策，并返回执行与回读确认结果。

完整安装、迁移、页面路由、防碰撞和超时恢复说明见 [AI 执行闭环指南](docs/agent-execution.md)。

```powershell
cd mcp-hub
npm install
npm run build:standalone
npm run service:start
npm run service:status
```

独立分发目录：`build/standalone/`。HTTP MCP：`http://127.0.0.1:7655/mcp`；stdio 统一使用 `node <绝对路径>/scripts/service.mjs stdio`。需 Node.js 22+。

## 整体链路

```
嘉立创 EDA（mcp-bridge）
    ↕ WebSocket 桥接
共享独立 Node.js 服务（VS Code / Cursor 为可选客户端）
    ↕ stdio/http MCP 协议
MCP 客户端（Copilot / Cursor Chat / Claude Code / Codex 等）
```

- **mcp-bridge**：EDA 侧扩展，建立到 mcp-hub 的 WebSocket 连接，负责让 AI 在嘉立创 EDA 中读取当前图纸信息并执行相关操作。
- **mcp-hub**：共享独立 MCP 服务与可选 VS Code/Cursor 客户端。stdio 代理复用服务，客户端关闭后后台服务继续运行。

## 可用工具

**基础工具**

| 工具                   | 说明                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `schematic_read`   | 读取当前原理图的完整电路语义快照，返回器件列表、引脚→网络名映射、网络连接关系与 DRC 检查结果 |
| `schematic_review` | 读取全工程所有原理图页面的网表文件，覆盖多页电路，适合全局审查、BOM 核查与跨页信号追踪       |
| `pcb_snapshot`     | 读取当前 PCB 页面归一化后的几何关系快照，返回图层、走线、过孔、覆铜、fill、region、image、object、实际覆铜填充区域、器件、焊盘与板框信息     |
| `pcb_geometry_analyze` | 分析当前 PCB 的几何关系，返回规范化 `relations`、`features` 与证据字段，支持路由拓扑、参考面连续性、换层回流过孔距离、平面投影 loop area proxy 与 trace/object 空间关系等事实型分析 |
| `pcb_constraint_snapshot` | 读取当前 PCB 的第二层约束与结构上下文快照，返回规则配置、网络规则、差分对、等长组、网络类以及更细的 pad/via 结构细节 |
| `component_select` | 搜索商城字段候选，提供型号/料号/封装/库存过滤和匹配依据，由 AI 决策 |
| `component_place` | 坐标/网格自动放置，检查包围盒、引脚及导线间距，回读确认图元位置 |
| `pin_net_configure` | 按精确引脚号配置 NET 标签，检查引脚粘连、既有网络和标签重叠 |
| `bridge_status` | 查询所有 EDA 页面身份、就绪状态、隔离状态和最近执行结果 |
| `document_focus` | 打开并激活明确的 EDA 文档，回读确认当前 UUID |

**透传 EDA API 工具（可选）**

在 mcp-hub 侧边栏「功能设置」中开启「暴露透传 EDA API 工具」后，以下工具将额外暴露给 AI 客户端，开关切换后立即生效。适合有进阶需求的用户探索使用。

| 工具           | 说明                                                                |
| ------------ | ------------------------------------------------------------------- |
| `api_index`  | 列出所有可用的 EDA API 模块名称，用于浏览 API 命名空间全貌               |
| `api_search` | 按关键词搜索具体 API 方法及其参数说明，便于 AI 定位所需接口           |
| `eda_context`| 读取当前 EDA 页面的上下文信息，包括活动页类型与当前工程基本状态       |
| `api_invoke` | 直接调用任意 EDA API 并将结果透传给 AI，适用于核心工具未覆盖的定制化任务           |

## 交互使用说明

1. 先用 `bridge_status` 识别目标客户端和原理图/PCB 文档，多页面时逐请求指定 `targetClientId` 与 `targetDocumentUuid`。
2. `component_select` 返回候选，由 AI 根据需求选择；`component_place` 直接执行，无侧边栏和鼠标放置等待。
3. `pin_net_configure` 可创建 VCC/GND 等网络标签。创建后须回读网表/DRC，不将 API 返回成功等同于电气正确。
4. 忙碌时明确返回未执行；超时标记结果未知并隔离，不自动重复写操作。防碰撞失败返回具体冲突，供 AI 调整布局。

## 安装

安装 EDA Bridge 与独立服务即可。VS Code/Cursor 扩展可选。

> 初次安装或从社区版迁移，请按 [统一入口说明](docs/agent-execution.md) 配置，避免继续登记多个旧版服务入口。

### mcp-hub（VS Code / Cursor）

**从扩展商店安装（推荐）：**

- VS Code：[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-hub)
- Cursor（Open VSX）：[open-vsx.org](https://open-vsx.org/extension/chengbin/jlceda-mcp-hub)

### mcp-bridge（嘉立创 EDA）

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP Bridge"并安装。

## 注意事项

1. 独立服务必须与 EDA Bridge 配套使用，不要求 VS Code 常驻。
2. 如果修改了服务端监听端口，需在 EDA Bridge 设置页同步更新桥接地址。
3. 服务可提前后台启动；Bridge 在原理图或 PCB 页面保持连接和心跳。
4. 多页面不会默默选一个执行：必须明确目标，错页或类型不符会拒绝。
5. 状态异常先查 `bridge_status` 或 `service:status`。单次 EDA API 无法通用强制取消，结果未知时需先核对 EDA 状态。

---

## 开发说明

以下内容面向开发者与维护者。

### 仓库结构

```text
JLCEDA-MCP/
├─ mcp-hub/         VS Code/Cursor 扩展与 stdio MCP 运行时
├─ mcp-bridge/      嘉立创 EDA 扩展与桥接 WebSocket 客户端
├─ shared/          Hub / Bridge 共用的桥接协议与消息契约
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

产物：`build/jlceda-mcp-hub-<version>.vsix`

**构建 mcp-bridge：**

```bash
cd mcp-bridge
npm install
npm run build
```

产物：`build/jlceda-mcp-bridge-<version>.eext`

### 验证

**验证 mcp-hub：**

```bash
cd mcp-hub
npm run test
npm run lint
npm run typecheck
```

**验证 mcp-bridge：**

```bash
cd mcp-bridge
npm run test
npm run lint
npm run typecheck
```

CI 质量门会在 Windows 环境按 `test -> lint -> typecheck -> build` 顺序校验 `mcp-hub` 与 `mcp-bridge`。

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
4. 发布前执行两端 `test`、`lint`、`typecheck` 与 `build`，确认 VSIX 与 EEXT 均可成功生成。
5. PCB 几何/约束分析能力通过 bridge plugin 接入；MCP handler 仅负责参数校验与插件分发，新增 PCB 能力时优先扩展插件契约与共享 schema，而不是在 runtime 中直接堆逻辑。

### 相关文档

- [mcp-hub/README.md](./mcp-hub/README.md)
- [mcp-bridge/README.md](./mcp-bridge/README.md)
- [mcp-hub/CHANGELOG.md](./mcp-hub/CHANGELOG.md)
- [mcp-bridge/CHANGELOG.md](./mcp-bridge/CHANGELOG.md)

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。
