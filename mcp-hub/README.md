# JLCEDA MCP Hub

本扩展为嘉立创 EDA **AI 设计助手** 的 MCP 版，支持双协议连接（stdio / http），在 VS Code / Cursor 内的 MCP 客户端（Copilot / Cursor Chat / Claude Code / Codex 等）中提供嘉立创 EDA 工具调用能力，配合嘉立创 EDA 侧的 **MCP Bridge** 扩展使用。

除核心原理图与器件工具外，还可在侧边栏「功能设置」中开启 **透传 EDA API** 模式，向 AI 客户端额外暴露对底层 EDA API 的直接查询与调用能力，适合有进阶需求的高级用户探索使用。

项目地址：https://github.com/sengbin/JLCEDA-MCP

---

## 可用工具

### 基础工具

- `schematic_read`：读取当前原理图页面的完整电路语义快照，包含器件列表、引脚网络连接关系与 DRC 检查结果。
- `schematic_review`：读取全工程所有原理图页面的网表文件，覆盖多页电路，适合全局审查、BOM 核查与跨页信号追踪。
- `component_select`：搜索器件候选项并返回确认结果。
- `component_place`：引导放置已确认的器件列表。

### 透传 EDA API 工具（可选）

在侧边栏「功能设置」中开启「暴露透传 EDA API 工具」后，以下四个工具将额外暴露给 AI 客户端。开关切换后立即生效，无需重启。

- `api_index`：列出所有可用的 EDA API 模块名称，用于浏览 API 命名空间全貌。
- `api_search`：按关键词搜索具体 API 方法及其参数说明，便于 AI 定位所需接口。
- `eda_context`：读取当前 EDA 页面的上下文信息，包括活动页类型与当前工程基本状态。
- `api_invoke`：直接调用任意 EDA API，将结果透传给 AI，适用于核心工具未覆盖的定制化任务。

---

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> 初次安装时，先确认 VS Code/Cursor 与嘉立创 EDA 两侧扩展都已安装，再检查聊天工具的 MCP 服务配置是否正确。

### 服务端（VS Code / Cursor）

**从扩展商店安装（推荐）：**

打开 VS Code 或 Cursor 扩展视图，搜索“JLCEDA MCP Hub”并安装。

- VS Code 扩展商店：https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-hub
- Cursor（Open VSX）：https://open-vsx.org/extension/chengbin/jlceda-mcp-hub

### 客户端（嘉立创 EDA）

客户端文档：[MCP Bridge README](https://github.com/sengbin/JLCEDA-MCP/blob/main/mcp-bridge/README.md)

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP Bridge"并安装。

---

## 注意事项

1. 本扩展需要与 EDA 侧 MCP Bridge 配套安装，单独安装无法在线调用。
2. 如果修改了监听端口，EDA MCP Bridge 中的地址必须同步更新。
3. 首次发起聊天后服务才会启动，且仅在原理图或 PCB 页面可连接。
4. 多页面同时连接时，只有活动角色执行任务，待命角色保持在线等待接管。若当前 EDA 页面与活动客户端不一致，请关闭其他 EDA 页面后刷新当前页。
5. 电源符号和地符号需要用户手动放置，AI 不会代替用户自动添加。
6. 状态异常时优先重载 VS Code/Cursor，再重连 EDA。

---

## 常见问题

### 安装后聊天里看不到工具怎么办？

请确认当前使用的是 VS Code 内置 Copilot 或 Cursor 内置 Chat，并确认当前聊天会话已信任该 MCP 服务且工具开关处于启用状态。

### 文档检索和上下文读取失败？

通常是 EDA MCP Bridge 未在线或状态异常，请回到 EDA 连接设置页检查连接状态。

### 修改端口后为什么失效？

服务端与MCP Bridge 地址必须完全一致，任何一侧未更新都会导致桥接失败。

---

## 许可证

本扩展采用 [Apache License 2.0](LICENSE) 许可证。

---

## 第三方库声明

本扩展侧边栏界面使用了以下开源库：

| 库                                                              | 版本   | 许可证 | 项目地址                                      |
| --------------------------------------------------------------- | ------ | ------ | --------------------------------------------- |
| [OverlayScrollbars](https://github.com/KingSora/OverlayScrollbars) | 2.14.0 | MIT    | https://github.com/KingSora/OverlayScrollbars |
