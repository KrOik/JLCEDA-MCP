# 嘉立创 EDA MCP

嘉立创 EDA MCP 是安装在 VS Code 或 Cursor 中的服务端扩展，与嘉立创 EDA 侧的 MCP 连接器配套使用，通过 MCP 协议向 Copilot、Claude、Gemini 等 AI 大模型提供三个工具：API 文档查询、上下文读取、在线 API 调用。

项目地址：https://github.com/sengbin/JLCEDA-MCP

## 安装

两个扩展都需要安装。**默认安装完成后无需任何配置，直接即可使用。**

### 服务端（VS Code / Cursor）

**从扩展商店安装（推荐）：**

打开 VS Code 或 Cursor 扩展视图，搜索"嘉立创 EDA MCP"并安装。

- VS Code 扩展商店：https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-server
- Cursor（Open VSX）：https://open-vsx.org/extension/chengbin/jlceda-mcp-server

**从 GitHub 安装包安装：**

1. 打开发布页：https://github.com/sengbin/JLCEDA-MCP/releases/tag/package
2. 下载 VSIX 安装包，执行"Extensions: Install from VSIX..."完成安装。

### 客户端（嘉立创 EDA）

客户端文档：[MCP 连接器 README](https://github.com/sengbin/JLCEDA-MCP/blob/main/mcp-connector/README.md)

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP连接器"并安装。

**从 GitHub 安装包安装：**

1. 打开发布页：https://github.com/sengbin/JLCEDA-MCP/releases/tag/package
2. 下载 `.eext` 安装包，在嘉立创 EDA 中导入并安装。

## 适用场景

1. 在聊天中查询嘉立创 EDA API 文档。
2. 读取当前工程、页面和选区上下文。
3. 让 AI 调用 EDA API 执行在线操作。

## 可用工具

- `jlceda_api_search`：查询 EDA API 文档，支持按名称、scope、owner 过滤，最多返回 50 条。
- `jlceda_context_get`：读取当前工程、文档、原理图、PCB、拼版与选区信息。
- `jlceda_api_invoke`：让 EDA 页面执行指定 API 并返回结果，支持自定义超时（1000–120000 ms）。

## 注意事项

1. 本扩展需要与 EDA 侧 MCP 连接器配套安装，单独安装无法在线调用。
2. 如果修改了监听端口，EDA 连接器中的地址必须同步更新。
3. 多页面同时连接时，只有活动角色执行任务，待命角色保持在线等待接管。
4. 状态异常时优先重载 VS Code/Cursor，再重连 EDA。

## 常见问题

### 安装后聊天里看不到工具怎么办？

请确认当前聊天会话已信任该 MCP 服务，并且工具开关处于启用状态。

### 文档检索和上下文读取失败？

通常是 EDA 连接器未在线或状态异常，请回到 EDA 连接设置页检查连接状态。

### 修改端口后为什么失效？

服务端与连接器地址必须完全一致，任何一侧未更新都会导致桥接失败。

## 许可证

本扩展采用 [Apache License 2.0](LICENSE) 许可证。

## 第三方库声明

本扩展侧边栏界面使用了以下开源库：

| 库 | 版本 | 许可证 | 项目地址 |
|----|------|--------|----------|
| [OverlayScrollbars](https://github.com/KingSora/OverlayScrollbars) | 2.14.0 | MIT | https://github.com/KingSora/OverlayScrollbars |
