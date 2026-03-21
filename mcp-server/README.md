# 嘉立创 EDA MCP

嘉立创 EDA MCP 是安装在 VS Code 或 Cursor 中的服务端扩展，需要与嘉立创 EDA 侧的 MCP 连接器配套使用。接入后，你可以直接在 Copilot、Cursor Chat、Claude Code 等 AI 助手中检查原理图、分析电路、辅助设计电路方案，并让 AI 在嘉立创 EDA 中完成相关操作。

项目地址：https://github.com/sengbin/JLCEDA-MCP

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> VS Code 内置 Copilot 和 Cursor 内置 Chat 在安装服务端扩展后会自动配置 MCP 服务；其他聊天工具如 Claude Code、Codex，需要手动配置 MCP 服务。

### 服务端（VS Code / Cursor）

**从扩展商店安装（推荐）：**

打开 VS Code 或 Cursor 扩展视图，搜索"嘉立创 EDA MCP"并安装。

- VS Code 扩展商店：https://marketplace.visualstudio.com/items?itemName=chengbin.jlceda-mcp-server
- Cursor（Open VSX）：https://open-vsx.org/extension/chengbin/jlceda-mcp-server

### 第三方聊天工具手动配置 MCP

如果你使用的是 Copilot 之外的第三方聊天工具，并且该工具不会自动读取 VS Code 或 Cursor 注册的 MCP 服务定义，可以手动把本扩展作为 stdio MCP 服务接入。

#### 运行入口

- 命令：Node.js 可执行文件，一般直接使用当前系统里的 `node`
- 运行脚本：扩展安装目录下的 `out/server/runtime.js`（Windows 下就是 `out\server\runtime.js`）
- 工作目录：建议设置为扩展根目录，也就是 `package.json` 所在目录

#### 必要参数

运行脚本后面至少需要带上这些参数：

- `--host 127.0.0.1`：桥接 WebSocket 监听地址；未修改配置时保持默认值即可
- `--port 8765`：桥接 WebSocket 监听端口；如果你在扩展设置中改过端口，这里必须保持一致
- `--status-file <可写入的状态文件绝对路径>`：必填，用来保存运行时状态；路径不存在时会自动创建父目录
- `--extension-version <当前扩展版本号>`：必填，必须与已安装扩展版本一致；扩展升级后这里也要跟着改

#### 可选参数

- `--enable-system-log false`：是否输出系统日志，默认可不写
- `--enable-connection-list false`：是否启用连接列表调试信息，默认可不写
- `--agent-instructions <Base64 文本>`：附加自定义 AI 指令，可不填；如果要传，内容需要先转成 Base64

#### 通用配置示例

下面是一个通用的 stdio MCP 配置示例。不同聊天工具的字段名可能略有区别，但 `command`、`args`、`cwd` 这三部分通常都需要。示例里的 `<当前扩展版本号>` 只是占位，实际使用时要替换成你本机已安装扩展的真实版本：

```json
{
  "mcpServers": {
    "jlceda": {
      "command": "node",
      "args": [
        "C:\\Users\\<你的用户名>\\.vscode\\extensions\\chengbin.jlceda-mcp-server-<当前扩展版本号>\\out\\server\\runtime.js",
        "--host",
        "127.0.0.1",
        "--port",
        "8765",
        "--status-file",
        "C:\\Users\\<你的用户名>\\AppData\\Roaming\\jlceda-mcp\\runtime-status.json",
        "--extension-version",
        "<当前扩展版本号>",
        "--enable-system-log",
        "false",
        "--enable-connection-list",
        "false"
      ],
      "cwd": "C:\\Users\\<你的用户名>\\.vscode\\extensions\\chengbin.jlceda-mcp-server-<当前扩展版本号>"
    }
  }
}
```

#### 配置时的注意点

1. 示例里的 `<当前扩展版本号>` 需要你手动替换，至少要同步改 3 个位置：扩展目录路径、`cwd` 路径、`--extension-version` 的参数值。
2. `runtime.js` 必须指向你本机实际安装的扩展目录，不能直接照抄示例路径。
3. `--extension-version` 必须和扩展当前版本一致，否则运行时会直接报错退出。
4. `--status-file` 必须使用当前用户有写权限的绝对路径。
5. `--port` 必须和嘉立创 EDA 连接器里配置的地址保持一致，否则工具调用无法桥接到 EDA。

### 客户端（嘉立创 EDA）

客户端文档：[MCP 连接器 README](https://github.com/sengbin/JLCEDA-MCP/blob/main/mcp-connector/README.md)

**从扩展管理器安装（推荐）：**

打开嘉立创 EDA，进入扩展管理器，搜索"MCP连接器"并安装。

**从 GitHub 安装包安装：**

1. 打开发布页：https://github.com/sengbin/JLCEDA-MCP/releases/tag/package
2. 下载 `.eext` 安装包，在嘉立创 EDA 中导入并安装。

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
