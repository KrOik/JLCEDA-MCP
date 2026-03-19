/**
 * ------------------------------------------------------------------------
 * 名称：侧边栏视图提供器
 * 说明：负责渲染桥接配置侧边栏并处理前端消息交互。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：用于 VS Code ActivityBar 的 Webview 侧边栏。
 * ------------------------------------------------------------------------
 */

import * as vscode from 'vscode';
import { DEBUG_SWITCH, SidebarDebugState } from './debug';
import { getRuntimeStatusFilePath, isRuntimeStatusSnapshotStale, readRuntimeStatusSnapshot } from './server/core/runtime-status';
import type { ConnectorVersionMismatch, ServerConfig, ServerStatus } from './server/core/status';
import type { ServerConfigStore } from './server/core/config';
import {
  getUnifiedLogFieldSchema,
  SERVER_STATUS_TEXT,
} from './status-log';
import { buildSidebarHtml } from './ui/sidebar-html';
import type {
  SidebarCommand,
  SidebarConnectedClientEntry,
  SidebarStatusLogEntry,
  SidebarWebviewMessage
} from './ui/sidebar-protocol';

// 侧边栏状态轮询间隔，单位毫秒。
const SIDEBAR_STATUS_REFRESH_INTERVAL_MS = 1000;

// 根据当前配置生成默认接入状态文案。
function createIdleState(config: ServerConfig): ServerStatus {
  return {
    host: config.host,
    port: config.port,
    runtimeStatus: 'idle',
    runtimeMessage: SERVER_STATUS_TEXT.runtimeReady,
    bridgeStatus: 'waiting',
    bridgeMessage: SERVER_STATUS_TEXT.bridgeWaiting,
    lastDisconnect: null,
    updatedAt: new Date().toISOString()
  };
}

interface SidebarRuntimeSnapshot {
  state: ServerStatus;
  clients: SidebarConnectedClientEntry[];
  logs: SidebarStatusLogEntry[];
  connectorVersionMismatch?: ConnectorVersionMismatch | null;
}

// 将运行时状态快照转换为侧边栏展示状态与连接列表。
function createSidebarRuntimeSnapshot(storageDirectoryPath: string, sessionId: string, config: ServerConfig): SidebarRuntimeSnapshot {
  const statusFilePath = getRuntimeStatusFilePath(storageDirectoryPath, config, sessionId);
  const snapshot = readRuntimeStatusSnapshot(statusFilePath);
  if (!snapshot) {
    return {
      state: createIdleState(config),
      clients: [],
      logs: []
    };
  }

  if (isRuntimeStatusSnapshotStale(snapshot) && (snapshot.runtimeStatus === 'running' || snapshot.runtimeStatus === 'starting')) {
    return {
      state: {
        host: config.host,
        port: config.port,
        runtimeStatus: 'stopped',
        runtimeMessage: SERVER_STATUS_TEXT.runtimeReady,
        bridgeStatus: 'waiting',
        bridgeMessage: SERVER_STATUS_TEXT.bridgeWaiting,
        lastDisconnect: snapshot.lastDisconnect,
        updatedAt: snapshot.updatedAt
      },
      clients: [],
      logs: []
    };
  }

  const connectedClientIds = snapshot.bridgeClientIds
    .map((clientId) => String(clientId ?? '').trim())
    .filter((clientId, index, allClientIds) => clientId.length > 0 && allClientIds.indexOf(clientId) === index);
  const clients: SidebarConnectedClientEntry[] = connectedClientIds.map((clientId, index) => ({
    clientId,
    role: index === 0 ? 'active' : 'standby'
  }));

  const bridgeStatus = snapshot.runtimeStatus === 'error'
    ? 'error'
    : clients.length > 0
      ? 'connected'
      : 'waiting';
  const bridgeMessage = snapshot.runtimeStatus === 'error'
    ? SERVER_STATUS_TEXT.bridgeUnavailable
    : clients.length > 0
      ? SERVER_STATUS_TEXT.bridgeConnected
      : SERVER_STATUS_TEXT.bridgeWaiting;

  return {
    state: {
      host: config.host,
      port: config.port,
      runtimeStatus: snapshot.runtimeStatus,
      runtimeMessage: snapshot.runtimeMessage,
      bridgeStatus,
      bridgeMessage,
      lastDisconnect: snapshot.lastDisconnect,
      updatedAt: snapshot.updatedAt
    },
    clients,
    logs: Array.isArray(snapshot.connectorLogs) ? snapshot.connectorLogs : [],
    connectorVersionMismatch: snapshot.connectorVersionMismatch ?? null
  };
}

export class McpSidebarViewProvider implements vscode.WebviewViewProvider {
  // 侧边栏视图注册标识。
  public static readonly viewId = 'jlcMcpControl.view';
  // 嘉立创编辑器页面地址。
  private static readonly editorUrl = 'https://pro.lceda.cn/editor';
  // 当前已解析的侧边栏视图实例。
  private view: vscode.WebviewView | undefined;
  // 侧边栏状态轮询定时器。
  private statusRefreshTimer: NodeJS.Timeout | undefined;
  // 调试卡片状态缓存与去重逻辑。
  private readonly debugState = new SidebarDebugState();
  // 已弹出过版本不一致提示的去重键，格式为 "connectorVersion|serverVersion"。
  private lastNotifiedVersionMismatch = '';

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly storageDirectoryPath: string,
    private readonly sessionId: string,
    private readonly configStore: ServerConfigStore,
    private readonly startStdioRuntime: () => Promise<void>,
    private readonly stopStdioRuntime: () => Promise<void>
  ) {}

  /**
   * 渲染侧边栏视图并建立消息通道。
   * @param webviewView 目标 Webview 视图实例。
   */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = buildSidebarHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message: SidebarCommand) => {
      await this.handleSidebarMessage(message);
    });

    this.configStore.onDidChangeConfig((config) => {
      this.postConfig(config);
      this.postInstructions();
      const runtimeSnapshot = createSidebarRuntimeSnapshot(this.storageDirectoryPath, this.sessionId, config);
      this.postState(runtimeSnapshot.state);
      this.postClients(runtimeSnapshot.clients);
    });

    webviewView.onDidDispose(() => {
      this.stopStatusRefreshLoop();
      this.view = undefined;
    });

    const config = this.configStore.getConfig();
    this.postConfig(config);
    this.postInstructions();
    if (DEBUG_SWITCH.enableSystemLog) {
      this.postLogSchema();
      this.postLogs();
    }
    this.syncState(createSidebarRuntimeSnapshot(this.storageDirectoryPath, this.sessionId, config));
    this.startStatusRefreshLoop();
  }

  private async handleSidebarMessage(message: SidebarCommand): Promise<void> {
    // 所有 UI 请求在这里集中分发。
    try {
      if (message.command === 'load') {
        const currentConfig = this.configStore.getConfig();
        this.debugState.resetClientsSignature();
        this.postConfig(currentConfig);
        this.postInstructions();
        this.postCloseSidebarOnOpenEditor();
        if (DEBUG_SWITCH.enableSystemLog) {
          this.postLogSchema();
          this.postLogs();
        }
        this.syncState(createSidebarRuntimeSnapshot(this.storageDirectoryPath, this.sessionId, currentConfig));
        return;
      }

      if (message.command === 'save') {
        this.configStore.validateConfig(message.payload);
        await this.configStore.updateConfig(message.payload);
        const savedConfig = this.configStore.getConfig();
        this.postConfig(savedConfig);
        this.syncState(createSidebarRuntimeSnapshot(this.storageDirectoryPath, this.sessionId, savedConfig));
        return;
      }

      if (message.command === 'saveInstructions') {
        await this.configStore.updateAgentInstructions(message.payload);
        this.postInstructions();
        return;
      }

      if (message.command === 'copyBridgeAddress') {
        await vscode.env.clipboard.writeText(message.payload);
        return;
      }

      if (message.command === 'copySelectedLog' || message.command === 'copyAllLogs') {
        await vscode.env.clipboard.writeText(message.payload);
        return;
      }

      if (message.command === 'clearLogs') {
        this.debugState.clearStatusLogs();
        this.postLogs();
        return;
      }

      if (message.command === 'openEditor') {
        await this.openSimpleBrowser();
        return;
      }

      if (message.command === 'startStdioRuntime') {
        await this.startStdioRuntime();
        return;
      }

      if (message.command === 'stopStdioRuntime') {
        await this.stopStdioRuntime();
        return;
      }

      if (message.command === 'setCloseSidebarOnOpenEditor') {
        await vscode.workspace.getConfiguration('jlcMcpServer').update(
          'closeSidebarOnOpenEditor',
          message.payload,
          vscode.ConfigurationTarget.Global
        );
        return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      // 仅在影响运行时状态的命令出错时才刷新状态，
      // 避免 copyBridgeAddress / copySelectedLog / copyAllLogs / clearLogs 等纯 UI 命令
      // 出错后错误地将运行时状态标记为 error。
      const isRuntimeCommand = message.command === 'load' || message.command === 'save'
        || message.command === 'startStdioRuntime' || message.command === 'stopStdioRuntime'
        || message.command === 'openEditor';
      if (isRuntimeCommand) {
        const current = this.configStore.getConfig();
        this.syncState({
          state: {
            ...current,
            runtimeStatus: 'error',
            runtimeMessage: SERVER_STATUS_TEXT.sidebarRefreshError,
            bridgeStatus: 'error',
            bridgeMessage: SERVER_STATUS_TEXT.sidebarBridgeReadError,
            lastDisconnect: null,
            updatedAt: new Date().toISOString()
          },
          clients: [],
          logs: []
        });
      }
      void vscode.window.showErrorMessage(messageText);
    }
  }

  // 定时读取运行时真实状态，刷新 stdio 与桥接客户端显示。
  private startStatusRefreshLoop(): void {
    this.stopStatusRefreshLoop();
    this.statusRefreshTimer = setInterval(() => {
      if (!this.view) {
        return;
      }

      const config = this.configStore.getConfig();
      this.syncState(createSidebarRuntimeSnapshot(this.storageDirectoryPath, this.sessionId, config));
    }, SIDEBAR_STATUS_REFRESH_INTERVAL_MS);
  }

  // 停止侧边栏状态轮询。
  private stopStatusRefreshLoop(): void {
    if (!this.statusRefreshTimer) {
      return;
    }

    clearInterval(this.statusRefreshTimer);
    this.statusRefreshTimer = undefined;
  }

  private postConfig(config: ServerConfig): void {
    // 将配置同步到前端输入框。
    this.postMessage({
      type: 'config',
      payload: config
    });
  }

  private postInstructions(): void {
    // 将当前 AI 助手指令同步到前端。
    this.postMessage({
      type: 'instructions',
      payload: this.configStore.getAgentInstructions()
    });
  }

  private postState(state: ServerStatus): void {
    // 将运行状态实时同步到前端显示区。
    this.postMessage({
      type: 'state',
      payload: state
    });
  }

  private postLogSchema(): void {
    if (!DEBUG_SWITCH.enableSystemLog) {
      return;
    }

    // 将统一日志字段定义同步到前端，供字段开关和展示使用。
    this.postMessage({
      type: 'logSchema',
      payload: getUnifiedLogFieldSchema()
    });
  }

  private postLogs(): void {
    if (!DEBUG_SWITCH.enableSystemLog) {
      return;
    }

    // 将当前会话内的状态日志同步到前端列表。
    this.postMessage({
      type: 'logs',
      payload: this.debugState.getStatusLogs()
    });
  }

  private postClients(clients: SidebarConnectedClientEntry[]): void {
    if (!DEBUG_SWITCH.enableConnectionList) {
      return;
    }

    // 仅在列表变化时推送，减少无效渲染。
    if (!this.debugState.shouldPostClients(clients)) {
      return;
    }

    this.postMessage({
      type: 'clients',
      payload: clients
    });
  }

  private syncState(runtimeSnapshot: SidebarRuntimeSnapshot): void {
    // 客户端断开时 connectorVersionMismatch 将变为 null，重置去重键使下次重连后可再次弹出。
    if (!runtimeSnapshot.connectorVersionMismatch) {
      this.lastNotifiedVersionMismatch = '';
    }

    // 版本不一致时弹出 VS Code 右下角错误气泡，每个不一致组合只弹一次。
    if (runtimeSnapshot.connectorVersionMismatch) {
      const mismatch = runtimeSnapshot.connectorVersionMismatch;
      const notifyKey = `${mismatch.connectorVersion}|${mismatch.serverVersion}`;
      if (notifyKey !== this.lastNotifiedVersionMismatch) {
        this.lastNotifiedVersionMismatch = notifyKey;
        const message = mismatch.lowerSide === 'connector'
          ? `EDA 连接器插件版本（${mismatch.connectorVersion}\uff09低于 MCP 服务端版本（${mismatch.serverVersion}\uff09，版本不一致可能导致功能异常，建议将 EDA 连接器插件升级至最新版本。`
          : `MCP 服务端插件版本（${mismatch.serverVersion}\uff09低于 EDA 连接器版本（${mismatch.connectorVersion}\uff09，版本不一致可能导致功能异常，建议将 MCP 服务端插件升级至最新版本。`;
        void vscode.window.showErrorMessage(message);
      }
    }

    // 状态变化时先更新日志，再同步当前展示状态与连接列表。
    if (DEBUG_SWITCH.enableSystemLog) {
      const hasExternalLogChanged = this.debugState.appendExternalLogs(runtimeSnapshot.logs);
      const hasStatusLogChanged = this.debugState.appendStatusLogIfChanged(runtimeSnapshot.state, runtimeSnapshot.clients);
      if (hasExternalLogChanged || hasStatusLogChanged) {
        this.postLogs();
      }
    }

    this.postState(runtimeSnapshot.state);
    if (DEBUG_SWITCH.enableConnectionList) {
      this.postClients(runtimeSnapshot.clients);
    }
  }

  private postCloseSidebarOnOpenEditor(): void {
    // 将「打开 EDA 时关闭侧边栏」设置值同步到前端开关。
    const config = vscode.workspace.getConfiguration('jlcMcpServer');
    this.postMessage({
      type: 'closeSidebarOnOpenEditor',
      payload: config.get<boolean>('closeSidebarOnOpenEditor', false)
    });
  }

  /**
   * 外部通知：「打开 EDA 时关闭侧边栏」设置已变更，同步到侧边栏开关。
   */
  public notifyCloseSidebarSettingChanged(): void {
    this.postCloseSidebarOnOpenEditor();
  }

  private postMessage(message: SidebarWebviewMessage): void {
    // 统一封装宿主到 Webview 的消息发送。
    void this.view?.webview.postMessage(message);
  }

  private async openSimpleBrowser(): Promise<void> {
    // 打开 VS Code 内置简易浏览器并跳转到嘉立创编辑器地址。
    await vscode.commands.executeCommand('simpleBrowser.show', McpSidebarViewProvider.editorUrl);

    // 若设置项开启，则关闭主侧边栏。
    const config = vscode.workspace.getConfiguration('jlcMcpServer');
    if (config.get<boolean>('closeSidebarOnOpenEditor', false)) {
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
    }
  }

  /**
   * 重新渲染侧边栏视图并推送初始数据，用于调试开关设置变更后立即刷新界面。
   */
  public refreshWebview(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = buildSidebarHtml(this.view.webview, this.extensionUri);
    const config = this.configStore.getConfig();
    this.postConfig(config);
    if (DEBUG_SWITCH.enableSystemLog) {
      this.postLogSchema();
      this.postLogs();
    }
    this.syncState(createSidebarRuntimeSnapshot(this.storageDirectoryPath, this.sessionId, config));
  }
}
