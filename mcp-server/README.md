# 嘉立创 EDA MCP

嘉立创 EDA MCP 是安装在 VS Code 或 Cursor 中的服务端扩展，需要与嘉立创 EDA 侧的 MCP 连接器配套使用。接入后，你可以直接在 Copilot、Cursor Chat 中检查原理图、分析电路、辅助设计电路方案，并让 AI 在嘉立创 EDA 中完成相关操作。

项目地址：https://github.com/sengbin/JLCEDA-MCP

## 当前可用工具

| 工具 | 说明 |
|------|------|
| `jlceda_schematic_check` | 对当前原理图执行完整检查，返回 ERC 结果和精简网表，便于 AI 做功能分析与连接性判断 |
| `component_select` | 在 EDA 系统库中搜索候选器件，并在侧边栏中由用户确认具体型号 |
| `component_place` | 按顺序启动器件交互放置流程，在侧边栏显示当前器件、进度与跳过状态 |

## 交互放置说明

1. AI 需要先确认型号时，会在侧边栏打开器件选型表格，由用户确认后再继续。
2. AI 需要放置器件时，会在侧边栏显示放置进度，用户按提示在原理图中逐个放置。
3. 选型或放置时点击取消，只会跳过当前器件，不会中断整个流程，也不会自动重试当前器件。
4. 电源符号和地符号不会自动放置，需要用户在 EDA 中手动添加。
5. 如果打开了“打开 EDA 时关闭侧边栏”，那么打开 EDA 后，以及器件选型或放置完成后，侧边栏会自动关闭。

---

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> 目前仅支持 VS Code 内置 Copilot 和 Cursor 内置 Chat，其他第三方聊天工具暂不支持。

> 初次安装时，先确认 VS Code/Cursor 与嘉立创 EDA 两侧扩展都已安装，再检查聊天工具的 MCP 服务配置是否正确。

### 服务端（VS Code / Cursor）

**从扩展商店安装（推荐）：**

打开 VS Code 或 Cursor 扩展视图，搜索"嘉立创 EDA MCP"并安装。

- VS Code 扩展商店：https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-server
- Cursor（Open VSX）：https://open-vsx.org/extension/chengbin/jlceda-mcp-server

### 客户端（嘉立创 EDA）

客户端文档：[MCP 连接器 README](https://github.com/sengbin/JLCEDA-MCP/blob/main/mcp-connector/README.md)

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP连接器"并安装。

---

## 注意事项

1. 本扩展需要与 EDA 侧 MCP 连接器配套安装，单独安装无法在线调用。
2. 如果修改了监听端口，EDA 连接器中的地址必须同步更新。
3. 首次发起聊天后服务才会启动，且仅在原理图或 PCB 页面可连接。
4. 多页面同时连接时，只有活动角色执行任务，待命角色保持在线等待接管。若当前 EDA 页面与活动客户端不一致，请关闭其他 EDA 页面后刷新当前页。
5. 电源符号和地符号需要用户手动放置，AI 不会代替用户自动添加。
6. 状态异常时优先重载 VS Code/Cursor，再重连 EDA。

---

## 常见问题

### 安装后聊天里看不到工具怎么办？

请确认当前使用的是 VS Code 内置 Copilot 或 Cursor 内置 Chat，并确认当前聊天会话已信任该 MCP 服务且工具开关处于启用状态。

### 文档检索和上下文读取失败？

通常是 EDA 连接器未在线或状态异常，请回到 EDA 连接设置页检查连接状态。

### 修改端口后为什么失效？

服务端与连接器地址必须完全一致，任何一侧未更新都会导致桥接失败。

---

## 许可证

本扩展采用 [Apache License 2.0](LICENSE) 许可证。

---

## 第三方库声明

本扩展侧边栏界面使用了以下开源库：

| 库 | 版本 | 许可证 | 项目地址 |
|----|------|--------|----------|
| [OverlayScrollbars](https://github.com/KingSora/OverlayScrollbars) | 2.14.0 | MIT | https://github.com/KingSora/OverlayScrollbars |
