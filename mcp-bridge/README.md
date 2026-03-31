# MCP Bridge

本扩展为嘉立创 EDA **AI 设计助手** 的 MCP 版，支持双协议连接（ stdio / http），在 VS Code / Cursor 内的聊天工具（Copilot/Chat/Claude Code/Codex等）中提供原理图分析、器件选型、交互放置等功能，配合 VS Code / Cursor 侧的 **嘉立创 EDA MCP** 扩展使用。

内置专用工具：

- 原理图语义读取：读取当前激活页面的完整电路语义快照，包含器件列表、引脚网络连接关系与 ERC 检查结果，AI 可直接理解电路结构与功能。
- 全工程原理图审查：读取全工程所有原理图页面的网表文件，覆盖多页电路，适合全局审查、BOM 核查与跨页信号追踪。
- 器件选型：在需要确认具体型号时，辅助筛选合适器件。
- 交互放置：在需要落图时，按确认结果引导器件放置。

![演示动画](images/demo.gif)

> 这套方案的链路是：EDA -> WebSocket (Bridge) -> stdio (MCP) -> AI 助手（Copilot / Cursor Chat/Claude Code/Codex）。

> B 站演示视频：https://www.bilibili.com/video/BV11QwuzxEDy/

项目地址：https://github.com/sengbin/JLCEDA-MCP

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> 初次安装时，先确认 VS Code/Cursor 与嘉立创 EDA 两侧扩展都已安装，再检查聊天工具的 MCP 服务配置是否正确。

### 客户端（嘉立创 EDA）

**从扩展管理器安装（推荐）：**

1. 打开嘉立创 EDA，进入扩展管理器。
2. 搜索"MCP Bridge"并安装。

### 服务端（VS Code / Cursor）

服务端文档：[嘉立创 EDA MCP 服务端 README](https://github.com/sengbin/JLCEDA-MCP/blob/main/mcp-server/README.md)

**从扩展商店安装（推荐）：**

打开 VS Code 或 Cursor 扩展视图，搜索"嘉立创 EDA MCP"并安装。

- VS Code 扩展商店：https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-server
- Cursor（Open VSX）：https://open-vsx.org/extension/chengbin/jlceda-mcp-server

## 状态说明

连接设置页面展示两行状态，每秒自动刷新：

- **第一行（桥接状态）**：活动页面显示"已连接"；待命页面显示"当前活动客户端：xxx"；连接失败显示"连接失败"。
- **第二行（WebSocket 状态）**：正在连接时显示"连接中"；连接成功后显示"当前客户端：xxx"；连接失败时显示具体错误原因。

仅在原理图或 PCB 页面可连接，连接失败后系统会自动重试。

## 交互说明

1. 当 AI 需要用户确认具体器件型号时，VS Code / Cursor 侧会弹出器件选型面板，确认后流程继续。
2. 当 AI 需要用户在原理图中实际放置器件时，VS Code / Cursor 侧会弹出交互放置面板，提示当前应放置的器件。
3. 在选型或放置过程中点击取消，只会跳过当前器件，不会让整个任务中断。
4. 电源符号和地符号需要用户手动添加，AI 不会自动放置这类符号。
5. 如果服务端启用了“打开 EDA 时关闭侧边栏”，那么打开 EDA 后，以及器件选型或放置完成后，VS Code / Cursor 侧边栏会自动收起。

## 注意事项

1. 客户端与服务端必须同时安装。
2. 如果修改了服务端监听端口，需要在 MCP Bridge 设置页同步更新地址。
3. 多页面并行时，只有活动角色页面执行任务，待命页面属于正常状态。若当前页面与活动客户端不一致，请关闭其他 EDA 页面并刷新当前页。
4. 电源符号和地符号需要用户手动放置。
5. 状态异常时优先重启嘉立创 EDA 与 VS Code/Cursor。

## 常见问题

### 聊天里看不到工具怎么办？

请在聊天客户端确认该 MCP 服务已被信任，并检查工具开关是否开启。

### AI 读不到当前图纸内容怎么办？

EDA 页面可能未桥接成功，请回到连接设置页确认连接状态是否正常。

### 保存地址后仍无法连接？

请确认服务端扩展已安装并运行，连接地址与侧边栏显示值完全一致。

## 许可证

本扩展采用 [Apache License 2.0](LICENSE) 许可证。
