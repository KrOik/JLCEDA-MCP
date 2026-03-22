# 嘉立创 EDA MCP

嘉立创 EDA MCP 是安装在 VS Code 或 Cursor 中的服务端扩展，需要与嘉立创 EDA 侧的 MCP 连接器配套使用。接入后，你可以直接在 Copilot、Cursor Chat 中检查原理图、分析电路、辅助设计电路方案，并让 AI 在嘉立创 EDA 中完成相关操作。

项目地址：https://github.com/sengbin/JLCEDA-MCP

---

## 安装

**服务端**和**客户端**两个扩展都需要安装。

> VS Code 内置 Copilot 和 Cursor 内置 Chat 在安装服务端扩展后会自动配置 MCP 服务；其他第三方聊天工具如 Claude Code、Codex，需要手动配置 MCP 服务。

> 初次安装时，先确认 VS Code/Cursor 与嘉立创 EDA 两侧扩展都已安装，再检查聊天工具的 MCP 服务配置是否正确。

### 使用模式说明

- 本扩展默认面向 VS Code/Cursor 内置聊天工具（Copilot、Cursor Chat）。
- 内置聊天工具会自动注册 MCP 服务定义，不需要手动配置 stdio。
- 第三方聊天工具（Claude Code、Codex）需要手动配置 stdio MCP，并独立启动 runtime。
- 第三方独立 runtime 不会复用 VS Code 内会话，因此 VS Code 扩展参数不会自动同步。
- 第三方会话运行时，VS Code 页面不会显示该会话的服务与连接状态。

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

### 第三方聊天工具手动配置 MCP

如果你使用的是 Copilot 之外的第三方聊天工具，并且该工具不会自动读取 VS Code 或 Cursor 注册的 MCP 服务定义，可以手动把本扩展作为 stdio MCP 服务接入。

> 说明：第三方手动接入会启动独立 runtime 进程，不会复用 VS Code 内置聊天会话，所以不会共享 VS Code 侧参数与状态显示。

#### MCP 配置说明

配置参数：
- `command`：启动命令，通常使用 `node`
- `args`：启动参数，至少包含 `runtime.js` 路径和 4 个关键参数
- `cwd`：工作目录，建议设置为扩展根目录（`package.json` 所在目录）

关键参数：
- `--host`：桥接监听地址，默认 `127.0.0.1`
- `--port`：桥接监听端口，默认 `8765`
- `--status-file`：状态文件绝对路径（必须可写）
- `--extension-version`：当前已安装扩展版本号

可选参数：
- `--enable-system-log false`：关闭系统日志输出
- `--enable-connection-list false`：关闭连接列表调试输出
- `--agent-instructions <Base64 文本>`：追加自定义 AI 指令

注意事项：
1. `runtime.js` 路径必须指向本机实际安装目录。
2. 版本号至少要在 3 个位置保持一致：扩展目录、`cwd`、`--extension-version`。
3. `--status-file` 必须使用当前用户有写权限的绝对路径。
4. `--port` 必须与嘉立创 EDA 连接器配置一致。
5. 扩展升级后需要同步更新路径和版本号参数。

#### Claude Code（stdio）配置（按官方方式）

参考 Claude Code 官方本地 stdio 配置方式（`claude mcp add --transport stdio <name> -- <command> [args...]`），针对“从扩展管理器安装”的本扩展，建议按下面步骤配置。

1. 确认扩展安装目录与版本号

  - VS Code 默认目录（Windows）：`C:\Users\<你的用户名>\.vscode\extensions\chengbin.jlceda-mcp-server-<版本号>`
  - Cursor 默认目录（Windows）：`C:\Users\<你的用户名>\.cursor\extensions\chengbin.jlceda-mcp-server-<版本号>`
  - 关键文件：`out\\server\\runtime.js`

2. 执行 Claude Code 添加命令（Windows 原生环境推荐 `cmd /c` 包装）

```bash
claude mcp add --transport stdio --scope user jlceda -- cmd /c node "C:\Users\<你的用户名>\.vscode\extensions\chengbin.jlceda-mcp-server-<版本号>\out\server\runtime.js" --host 127.0.0.1 --port 8765 --status-file "C:\Users\<你的用户名>\AppData\Roaming\jlceda-mcp\runtime-status.json" --extension-version <版本号> --enable-system-log false --enable-connection-list false
```

3. 校验是否配置成功

```bash
claude mcp list
claude mcp get jlceda
```

然后在 Claude Code 中输入 `/mcp`，确认 `jlceda` 服务状态正常。

4. 关键注意事项

  - 选项顺序必须正确：`--transport`、`--scope` 等选项要在服务名 `jlceda` 之前；`--` 之后才是实际启动命令和参数。
  - Windows 下如果命令使用 `npx` 或复杂启动链，官方建议使用 `cmd /c`，否则可能出现连接立即关闭。
  - `--extension-version` 必须与本机已安装扩展版本完全一致，否则运行时会拒绝启动。
  - `--port` 必须与嘉立创 EDA 连接器配置一致（默认 `8765`）。

5. 团队共享（可选）

如果希望项目成员共享同一 MCP 配置，可改用 `--scope project`，Claude Code 会在项目根目录写入 `.mcp.json`。如果只给当前用户使用，保留 `--scope user` 即可。

#### Codex（stdio）配置（按官方方式）

参考 Codex 官方 MCP 文档，Codex 支持通过 CLI 或直接编辑 `config.toml` 两种方式接入 stdio MCP 服务。

1. 配置文件位置（官方）

  - 用户级：`~/.codex/config.toml`
  - 项目级（受信任项目）：`.codex/config.toml`
  - Codex CLI 与 IDE 扩展共享同一份 MCP 配置

2. 方式一：用 Codex CLI 添加

官方语法：

```bash
codex mcp add <server-name> --env VAR1=VALUE1 -- <stdio server-command>
```

结合本扩展的示例（Windows）：

```bash
codex mcp add jlceda -- node "C:\Users\<你的用户名>\.vscode\extensions\chengbin.jlceda-mcp-server-<版本号>\out\server\runtime.js" --host 127.0.0.1 --port 8765 --status-file "C:\Users\<你的用户名>\AppData\Roaming\jlceda-mcp\runtime-status.json" --extension-version <版本号> --enable-system-log false --enable-connection-list false
```

3. 方式二：直接编辑 `config.toml`

在 `~/.codex/config.toml`（或项目级 `.codex/config.toml`）中添加：

```toml
[mcp_servers.jlceda]
command = "node"
args = [
  "C:\\Users\\<你的用户名>\\.vscode\\extensions\\chengbin.jlceda-mcp-server-<版本号>\\out\\server\\runtime.js",
  "--host", "127.0.0.1",
  "--port", "8765",
  "--status-file", "C:\\Users\\<你的用户名>\\AppData\\Roaming\\jlceda-mcp\\runtime-status.json",
  "--extension-version", "<版本号>",
  "--enable-system-log", "false",
  "--enable-connection-list", "false"
]
cwd = "C:\\Users\\<你的用户名>\\.vscode\\extensions\\chengbin.jlceda-mcp-server-<版本号>"
```

4. 校验连接

  - 在 Codex 终端界面使用 `/mcp` 查看活动 MCP 服务
  - 使用 `codex mcp --help` 查看可用 MCP 管理命令

5. 关键注意事项

  - `runtime.js` 路径必须是你本机实际安装目录。
  - `--extension-version` 必须与已安装扩展版本一致。
  - `--port` 必须与嘉立创 EDA 连接器配置一致（默认 `8765`）。

---

## 注意事项

1. 本扩展需要与 EDA 侧 MCP 连接器配套安装，单独安装无法在线调用。
2. 如果修改了监听端口，EDA 连接器中的地址必须同步更新。
3. 首次发起聊天后服务才会启动，且仅在原理图或 PCB 页面可连接。
4. 多页面同时连接时，只有活动角色执行任务，待命角色保持在线等待接管。若当前 EDA 页面与活动客户端不一致，请关闭其他 EDA 页面后刷新当前页。
5. 状态异常时优先重载 VS Code/Cursor，再重连 EDA。

---

## 常见问题

### 安装后聊天里看不到工具怎么办？

请确认当前聊天会话已信任该 MCP 服务，并且工具开关处于启用状态。

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
