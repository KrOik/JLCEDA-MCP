/**
 * ------------------------------------------------------------------------
 * 名称：扩展主入口
 * 说明：负责激活扩展并按宿主类型注册 stdio MCP 服务定义与侧边栏。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：扩展生命周期入口文件。
 * ------------------------------------------------------------------------
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as vscode from 'vscode';
import { ServerConfigStore } from './server/core/config';
import { updateDebugSwitch, type DebugSwitchValues } from './debug';
import { JlcMcpDefinitionProvider } from './server/core/provider';
import { createCursorStdioServerConfig, JLC_MCP_SERVER_NAME, type CursorStdioServerConfig } from './server/core/stdio';
import { McpSidebarViewProvider } from './sidebar/sidebar';
import { getRuntimeStatusFilePath, isRuntimeStatusSnapshotStale, readRuntimeStatusSnapshot } from './state/runtime-status';

interface CursorMcpApi {
  registerServer(config: CursorStdioServerConfig): void;
  unregisterServer(serverName: string): void;
}

type VscodeWithCursorApi = typeof vscode & {
  cursor?: {
    mcp?: CursorMcpApi;
  };
};

let manualStdioRuntimeProcess: ChildProcessWithoutNullStreams | undefined;

// 读取 Cursor 提供的 MCP 扩展 API。
function getCursorMcpApi(): CursorMcpApi | undefined {
  return (vscode as VscodeWithCursorApi).cursor?.mcp;
}

// 通过宿主名称识别当前是否运行在 Cursor 中。
function isCursorHost(): boolean {
  return /cursor/i.test(vscode.env.appName);
}

// 确保扩展全局存储目录存在，供运行时状态文件写入。
function ensureStorageDirectory(storageDirectoryPath: string): void {
  fs.mkdirSync(storageDirectoryPath, { recursive: true });
}

// 在 Cursor 中重新注册 stdio MCP 服务定义。
function registerCursorMcpServer(
  extensionPath: string,
  storageDirectoryPath: string,
  sessionId: string,
  configStore: ServerConfigStore,
  extensionVersion: string
): void {
  const cursorMcpApi = getCursorMcpApi();
  if (!cursorMcpApi) {
    return;
  }

  const config = configStore.getConfig();
  configStore.validateConfig(config);
  cursorMcpApi.unregisterServer(JLC_MCP_SERVER_NAME);
  cursorMcpApi.registerServer(createCursorStdioServerConfig(extensionPath, storageDirectoryPath, sessionId, config, extensionVersion, configStore.getAgentInstructions(), configStore.getHttpPort()));
}

// 清理 Cursor 中的已注册服务定义。
function unregisterCursorMcpServer(): void {
  const cursorMcpApi = getCursorMcpApi();
  if (!cursorMcpApi) {
    return;
  }

  cursorMcpApi.unregisterServer(JLC_MCP_SERVER_NAME);
}

// 从 VS Code 配置读取调试开关设置。
function readDebugSwitchFromConfig(): DebugSwitchValues {
  const config = vscode.workspace.getConfiguration('jlcMcpServer');
  return {
    enableSystemLog: config.get<boolean>('enableSystemLog', false),
    enableConnectionList: config.get<boolean>('enableConnectionList', false),
    enableDebugControlCard: config.get<boolean>('enableDebugControlCard', false),
  };
}

// 判断手动启动的 stdio 进程当前是否仍在运行。
function hasRunningManualStdioRuntimeProcess(): boolean {
  if (!manualStdioRuntimeProcess) {
    return false;
  }

  return manualStdioRuntimeProcess.exitCode === null
    && !manualStdioRuntimeProcess.killed;
}

// 清理已退出的手动 stdio 进程引用。
function clearExitedManualStdioRuntimeProcess(): void {
  if (!manualStdioRuntimeProcess) {
    return;
  }

  if (manualStdioRuntimeProcess.exitCode !== null || manualStdioRuntimeProcess.killed) {
    manualStdioRuntimeProcess = undefined;
  }
}

// 结束手动启动的 stdio 进程。
function stopManualStdioRuntimeProcess(): void {
  if (!manualStdioRuntimeProcess) {
    return;
  }

  if (manualStdioRuntimeProcess.exitCode === null && !manualStdioRuntimeProcess.killed) {
    manualStdioRuntimeProcess.kill();
  }
  manualStdioRuntimeProcess = undefined;
}

// 响应侧边栏调试按钮，停止手动启动的 stdio 进程。
async function stopManualStdioRuntimeProcessFromSidebar(): Promise<void> {
  clearExitedManualStdioRuntimeProcess();
  if (!manualStdioRuntimeProcess) {
    await vscode.window.showInformationMessage('当前没有手动启动的运行时进程。');
    return;
  }

  stopManualStdioRuntimeProcess();
  await vscode.window.showInformationMessage('已停止手动启动的运行时进程。');
}

// 手动启动 stdio 运行时进程。
async function startManualStdioRuntimeProcess(
  extensionPath: string,
  storageDirectoryPath: string,
  sessionId: string,
  configStore: ServerConfigStore,
  extensionVersion: string
): Promise<void> {
  clearExitedManualStdioRuntimeProcess();
  if (hasRunningManualStdioRuntimeProcess()) {
    await vscode.window.showInformationMessage('运行时进程已在手动调试模式运行。');
    return;
  }

  const config = configStore.getConfig();
  configStore.validateConfig(config);
  const statusFilePath = getRuntimeStatusFilePath(storageDirectoryPath, config, sessionId);
  const runtimeSnapshot = readRuntimeStatusSnapshot(statusFilePath);
  if (runtimeSnapshot
    && !isRuntimeStatusSnapshotStale(runtimeSnapshot)
    && (runtimeSnapshot.runtimeStatus === 'running' || runtimeSnapshot.runtimeStatus === 'starting')) {
    await vscode.window.showInformationMessage('运行时进程当前已在运行，无需重复启动。');
    return;
  }

  const runtimeScriptPath = path.join(extensionPath, 'out', 'server', 'runtime.js');
  if (!fs.existsSync(runtimeScriptPath)) {
    throw new Error(`未找到运行时入口文件: ${runtimeScriptPath}`);
  }

  const cursorConfig = createCursorStdioServerConfig(extensionPath, storageDirectoryPath, sessionId, config, extensionVersion, configStore.getAgentInstructions(), configStore.getHttpPort());
  const manualProcess = spawn(cursorConfig.server.command, cursorConfig.server.args, {
    cwd: extensionPath,
    env: {
      ...process.env,
      ...cursorConfig.server.env,
    },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  manualStdioRuntimeProcess = manualProcess;

  // 持续读取输出，避免长时间运行时因缓冲区占满导致子进程阻塞。
  manualProcess.stdout.on('data', () => {
    return;
  });
  manualProcess.stderr.on('data', () => {
    return;
  });

  manualProcess.once('error', (error) => {
    if (manualStdioRuntimeProcess === manualProcess) {
      manualStdioRuntimeProcess = undefined;
    }
    void vscode.window.showErrorMessage(`手动启动运行时进程失败：${error.message}`);
  });

  manualProcess.once('exit', () => {
    if (manualStdioRuntimeProcess === manualProcess) {
      manualStdioRuntimeProcess = undefined;
    }
  });

  await vscode.window.showInformationMessage('已手动触发运行时进程启动。');
}

// 扩展激活时自动拉起 stdio 运行时，供 HTTP MCP 客户端连接使用。
// forceRestart 为 true 时跳过状态文件的过期检查，用于配置变更后强制重启。
function autoStartStdioRuntime(
  extensionPath: string,
  storageDirectoryPath: string,
  sessionId: string,
  configStore: ServerConfigStore,
  extensionVersion: string,
  forceRestart = false
): void {
  if (configStore.getHttpPort() <= 0) {
    return;
  }

  clearExitedManualStdioRuntimeProcess();
  if (hasRunningManualStdioRuntimeProcess()) {
    return;
  }

  const config = configStore.getConfig();
  if (!forceRestart) {
    const statusFilePath = getRuntimeStatusFilePath(storageDirectoryPath, config, sessionId);
    const runtimeSnapshot = readRuntimeStatusSnapshot(statusFilePath);
    if (runtimeSnapshot
      && !isRuntimeStatusSnapshotStale(runtimeSnapshot)
      && (runtimeSnapshot.runtimeStatus === 'running' || runtimeSnapshot.runtimeStatus === 'starting')) {
      return;
    }
  }

  const runtimeScriptPath = path.join(extensionPath, 'out', 'server', 'runtime.js');
  if (!fs.existsSync(runtimeScriptPath)) {
    return;
  }

  const cursorConfig = createCursorStdioServerConfig(extensionPath, storageDirectoryPath, sessionId, config, extensionVersion, configStore.getAgentInstructions(), configStore.getHttpPort());
  const proc = spawn(cursorConfig.server.command, cursorConfig.server.args, {
    cwd: extensionPath,
    env: { ...process.env, ...cursorConfig.server.env },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  manualStdioRuntimeProcess = proc;

  proc.stdout.on('data', () => { return; });
  proc.stderr.on('data', () => { return; });

  proc.once('error', () => {
    if (manualStdioRuntimeProcess === proc) {
      manualStdioRuntimeProcess = undefined;
    }
  });

  proc.once('exit', () => {
    if (manualStdioRuntimeProcess === proc) {
      manualStdioRuntimeProcess = undefined;
    }
  });
}

/**
 * 扩展激活入口，负责注册 UI 与宿主侧 MCP 服务定义。
 * @param context VS Code 扩展上下文。
 */
export function activate(context: vscode.ExtensionContext): void {
  const configStore = new ServerConfigStore();
  const storageDirectoryPath = context.globalStorageUri.fsPath;
  const sessionId = vscode.env.sessionId;
  const extensionVersion = String(context.extension.packageJSON.version);
  ensureStorageDirectory(storageDirectoryPath);
  updateDebugSwitch(readDebugSwitchFromConfig());
  context.subscriptions.push(configStore);
  context.subscriptions.push(new vscode.Disposable(() => {
    stopManualStdioRuntimeProcess();
  }));

  const sidebarProvider = new McpSidebarViewProvider(
    context.extensionUri,
    storageDirectoryPath,
    sessionId,
    configStore,
    async () => {
      await startManualStdioRuntimeProcess(context.extensionPath, storageDirectoryPath, sessionId, configStore, extensionVersion);
    },
    async () => {
      await stopManualStdioRuntimeProcessFromSidebar();
    }
  );
  sidebarProvider.startInteractionSyncLoop();
  context.subscriptions.push(new vscode.Disposable(() => {
    sidebarProvider.dispose();
  }));
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(McpSidebarViewProvider.viewId, sidebarProvider)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('jlcMcpServer.enableSystemLog')
        || event.affectsConfiguration('jlcMcpServer.enableConnectionList')
        || event.affectsConfiguration('jlcMcpServer.enableDebugControlCard')) {
        updateDebugSwitch(readDebugSwitchFromConfig());
        sidebarProvider.refreshWebview();
      }
      if (event.affectsConfiguration('jlcMcpServer.closeSidebarOnOpenEditor')) {
        sidebarProvider.notifyCloseSidebarSettingChanged();
      }
    })
  );

  if (isCursorHost() && getCursorMcpApi()) {
    registerCursorMcpServer(context.extensionPath, storageDirectoryPath, sessionId, configStore, extensionVersion);
    context.subscriptions.push(configStore.onDidChangeConfig(() => {
      registerCursorMcpServer(context.extensionPath, storageDirectoryPath, sessionId, configStore, extensionVersion);
    }));
    context.subscriptions.push(new vscode.Disposable(() => {
      unregisterCursorMcpServer();
    }));
    return;
  }

  const provider = new JlcMcpDefinitionProvider(context.extensionPath, storageDirectoryPath, sessionId, configStore, extensionVersion, stopManualStdioRuntimeProcess);
  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('jlcMcpControl.provider', provider));

  // HTTP MCP 传输已启用时，扩展激活阶段自动拉起运行时，确保外部工具可立即连接。
  autoStartStdioRuntime(context.extensionPath, storageDirectoryPath, sessionId, configStore, extensionVersion);

  // 配置变更时停止旧运行时进程并用新配置重新拉起，确保设置保存后立即生效。
  context.subscriptions.push(configStore.onDidChangeConfig(() => {
    try {
      configStore.validateConfig(configStore.getConfig());
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`配置错误：${msg}`);
      return;
    }
    sidebarProvider.resetRuntimeErrorState();
    stopManualStdioRuntimeProcess();
    autoStartStdioRuntime(context.extensionPath, storageDirectoryPath, sessionId, configStore, extensionVersion, true);
  }));
}

/**
 * 扩展卸载入口，确保 Cursor 注册项被清理。
 */
export function deactivate(): void {
  stopManualStdioRuntimeProcess();
  unregisterCursorMcpServer();
}
