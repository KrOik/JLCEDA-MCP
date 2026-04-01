/**
 * ------------------------------------------------------------------------
 * 名称：MCP 运行时入口
 * 说明：启动 stdio MCP 服务、桥接 WebSocket 服务与运行时状态心跳。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：采用桥接角色裁决模型。
 * ------------------------------------------------------------------------
 */

import {
	attachBridgeClientSocket,
	flushBridgeLogs,
	getBridgeStatus,
	notifyBridgeClientsDisconnect,
	pumpBridgeBroker,
	setBridgeDisconnectHandler,
	setServerVersion,
	setVersionMismatchHandler,
	type BridgeDisconnectEvent,
	type BridgeVersionMismatchEvent,
} from './bridge/broker';
import * as fs from 'fs';
import * as path from 'path';
import { DEBUG_SWITCH, updateDebugSwitch } from '../debug';
import type { UnifiedLogLevel } from '../logging/server-log';
import { RuntimeLogPipeline, type RuntimeLogExtra } from '../logging/runtime-log';
import { STATUS_FILE_FLAG, writeRuntimeStatusSnapshot } from '../state/runtime-status';
import {
	clearSidebarInteractionRequest,
	clearSidebarInteractionResponse,
} from '../state/sidebar-interaction';
import { ServerStateManager } from '../state/server-state-manager';
import type { BridgeDisconnectSnapshot, BridgeVersionMismatch, RuntimeStatus, RuntimeStatusSnapshot } from '../state/status';
import { RpcHandler } from './mcp/rpc-handler';
import { ToolDispatcher } from './mcp/tool-dispatcher';
import { createStdioLineTransport } from './core/transports/line-transport';
import { toSafeErrorMessage } from '../utils';
import { startBridgeWebSocketServer } from './core/transports/bridge-server';
import { startHttpMcpServer } from './core/transports/http-server';

const HOST_FLAG = '--host';
const PORT_FLAG = '--port';
const STORAGE_DIRECTORY_FLAG = '--storage-directory';
const SESSION_ID_FLAG = '--session-id';
const STATUS_FILE_PATH_FLAG = STATUS_FILE_FLAG;
const EXTENSION_VERSION_FLAG = '--extension-version';
const AGENT_INSTRUCTIONS_FLAG = '--agent-instructions';
const DEBUG_ENABLE_SYSTEM_LOG_FLAG = '--enable-system-log';
const DEBUG_ENABLE_CONNECTION_LIST_FLAG = '--enable-connection-list';
const HTTP_PORT_FLAG = '--http-port';
const BRIDGE_WS_PATH = '/bridge/ws';
const RUNTIME_STATUS_HEARTBEAT_INTERVAL_MS = 1000;
const SERVER_STATUS_TEXT = ServerStateManager.text;

// 转换运行时异常为可展示文本。
function toRuntimeErrorMessage(error: unknown, host: string, port: number): string {
	const errorCode = typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code ?? '')
		: '';
	if (errorCode === 'EADDRINUSE') {
		return `桥接监听端口 ${host}:${port} 已被占用，可能已有另一个 VS Code 或 Cursor 正在使用该地址。`;
	}

	const message = toSafeErrorMessage(error);
	if (message.includes('EADDRINUSE')) {
		return `桥接监听端口 ${host}:${port} 已被占用，可能已有另一个 VS Code 或 Cursor 正在使用该地址。`;
	}
	return message;
}

class McpRuntimeServer {
	private runtimeStatusTimer: NodeJS.Timeout | undefined;
	private runtimeStatus: Exclude<RuntimeStatus, 'idle'> = 'starting';
	private runtimeMessage: string = SERVER_STATUS_TEXT.runtime.starting;
	private lastErrorMessage = '';
	private lastDisconnect: BridgeDisconnectSnapshot | null = null;
	private lastVersionMismatch: BridgeVersionMismatch | null = null;
	private readonly runtimeLogPipeline: RuntimeLogPipeline;

	public constructor(
		private readonly host: string,
		private readonly port: number,
		private readonly httpPort: number,
		private readonly rpcHandler: RpcHandler,
		private readonly statusFilePath: string,
		private readonly toolDispatcher: ToolDispatcher,
		private readonly rawApiToolsFlagFilePath: string,
	) {
		this.runtimeLogPipeline = new RuntimeLogPipeline(host, port);
	}

	/**
	 * 启动运行时服务。
	 */
	public start(): void {
		let shuttingDown = false;
		this.writeRuntimeStatus('starting', SERVER_STATUS_TEXT.runtime.starting);
		setVersionMismatchHandler((event: BridgeVersionMismatchEvent) => {
			this.lastVersionMismatch = {
				bridgeVersion: event.bridgeVersion,
				serverVersion: event.serverVersion,
				lowerSide: event.lowerSide,
			};
			this.writeRuntimeStatus(this.runtimeStatus, this.runtimeMessage, this.lastErrorMessage);
		});
		setBridgeDisconnectHandler((event: BridgeDisconnectEvent) => {
			// 客户端断开时清除版本不一致状态，使下次重连时不一致依然得到提醒。
			this.lastVersionMismatch = null;
			const bridgeStatus = getBridgeStatus();
			const activeClientId = bridgeStatus.clientIds.length > 0 ? bridgeStatus.clientIds[0] : '';
			const level: UnifiedLogLevel = event.disconnectType === 'socket_error' || event.disconnectType === 'send_failure'
				? 'error'
				: 'warning';
			this.writeRuntimeStatus(this.runtimeStatus, this.runtimeMessage, this.lastErrorMessage, event);
			this.writeLog(level, 'runtime.bridge.websocket.disconnected', 'WebSocket 连接断开', event.detail, {
				runtimeStatus: this.runtimeStatus,
				bridgeStatus: bridgeStatus.connectedClients > 0 ? 'connected' : 'waiting',
				contextKey: 'bridge',
				clientId: event.clientId,
				activeClientId,
				leaseTerm: String(event.leaseTerm),
				bridgeClientCount: String(event.remainingClientCount),
				detail: event.detail,
				errorCode: level === 'error' ? `ws_disconnect_${event.disconnectType}` : '',
				disconnectType: event.disconnectType,
				disconnectActor: event.disconnectActor,
				disconnectClientRole: event.clientRole,
				disconnectCloseCode: event.closeCode,
				disconnectCloseReason: event.closeReason,
				disconnectDurationMs: String(event.connectedDurationMs),
				disconnectOccurredAt: event.occurredAt,
			});
		});

		const bridgeWebSocketServer = startBridgeWebSocketServer({
			host: this.host,
			port: this.port,
			path: BRIDGE_WS_PATH,
			onConnection: (socket) => {
				attachBridgeClientSocket(socket);
			},
			onListening: () => {
				this.writeRuntimeStatus('running', SERVER_STATUS_TEXT.runtime.running);
				this.startRuntimeStatusHeartbeat();
				this.writeLog('success', 'runtime.bridge.listening', '桥接监听已就绪', `桥接已监听 ws://${this.host}:${this.port}${BRIDGE_WS_PATH}`);
			},
			onError: (error) => {
				const detailMessage = toRuntimeErrorMessage(error, this.host, this.port);
				this.stopRuntimeStatusHeartbeat();
				this.writeRuntimeStatus('error', SERVER_STATUS_TEXT.runtime.error, detailMessage);
				this.writeLog('error', 'runtime.bridge.error', '桥接服务异常', detailMessage, {
					runtimeStatus: '异常',
					bridgeStatus: '桥错',
					detail: detailMessage,
					errorCode: 'bridge_runtime_error',
				});
				void shutdown(1, false);
			},
		});

		const stdioTransport = createStdioLineTransport(async (line: string) => {
			await this.handleStdioLine(line, stdioTransport.write);
		});
		stdioTransport.start();

		let httpMcpServer: ReturnType<typeof startHttpMcpServer> | undefined;
		if (this.httpPort > 0) {
			httpMcpServer = startHttpMcpServer({
				port: this.httpPort,
				rpcHandler: this.rpcHandler,
				onListening: () => {
					this.writeLog('success', 'runtime.http.listening', 'HTTP MCP 监听已就绪', `HTTP MCP 已监听 http://127.0.0.1:${this.httpPort}/mcp`);
				},
				onError: (error) => {
					const detailMessage = toRuntimeErrorMessage(error, '127.0.0.1', this.httpPort);
					this.stopRuntimeStatusHeartbeat();
					this.writeRuntimeStatus('error', SERVER_STATUS_TEXT.runtime.error, detailMessage);
					this.writeLog('error', 'runtime.http.error', 'HTTP MCP 服务异常', detailMessage, {
						runtimeStatus: '异常',
						errorCode: 'http_runtime_error',
						detail: detailMessage,
					});
					void shutdown(1, false);
				},
			});
		}

		// 监听透传 EDA API 工具开关标志文件，变化时动态更新工具列表并推送通知。
		let lastFlagContent = '';
		const watchFlagFile = (): void => {
			try {
				const content = fs.existsSync(this.rawApiToolsFlagFilePath)
					? fs.readFileSync(this.rawApiToolsFlagFilePath, 'utf8').trim()
					: '';
				if (content === lastFlagContent) {
					return;
				}
				lastFlagContent = content;
				const newValue = content === '1';
				this.toolDispatcher.updateExposeRawApiTools(newValue);
				// 向已连接的 SSE 客户端广播工具列表变更通知。
				httpMcpServer?.broadcastToolsListChanged();
				// 向 stdio 客户端（VS Code Copilot）发送工具列表变更通知。
				stdioTransport.write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
			} catch {
				// 文件读取失败时忽略，等待下次轮询。
			}
		};
		fs.watchFile(this.rawApiToolsFlagFilePath, { interval: 500, persistent: false }, watchFlagFile);

		const shutdown = async (exitCode = 0, writeStoppedStatus = true): Promise<void> => {
			if (shuttingDown) {
				return;
			}
			shuttingDown = true;
			this.stopRuntimeStatusHeartbeat();
			if (writeStoppedStatus) {
				this.writeRuntimeStatus('stopped', SERVER_STATUS_TEXT.runtime.stopped);
			}

			await notifyBridgeClientsDisconnect(SERVER_STATUS_TEXT.bridge.disconnectNotice);
			for (const client of bridgeWebSocketServer.server.clients) {
				client.close(1001, SERVER_STATUS_TEXT.bridge.serverClosingReason);
			}
			await bridgeWebSocketServer.close();
			if (httpMcpServer) {
				await httpMcpServer.close();
			}
			fs.unwatchFile(this.rawApiToolsFlagFilePath);
			setBridgeDisconnectHandler(undefined);
			setVersionMismatchHandler(undefined);
			this.writeLog('info', 'runtime.stopped', '服务已停止', SERVER_STATUS_TEXT.runtime.stopped, {
				runtimeStatus: '停止',
				bridgeStatus: '等待',
			});
			process.exit(exitCode);
		};

		process.on('SIGTERM', () => {
			void shutdown();
		});
		process.on('SIGINT', () => {
			void shutdown();
		});
		process.stdin.on('end', () => {
			void shutdown();
		});
	}

	// 启动运行时心跳。
	private startRuntimeStatusHeartbeat(): void {
		this.stopRuntimeStatusHeartbeat();
		this.runtimeStatusTimer = setInterval(() => {
			void pumpBridgeBroker().finally(() => {
				this.writeRuntimeStatus(this.runtimeStatus, this.runtimeMessage, this.lastErrorMessage);
			});
		}, RUNTIME_STATUS_HEARTBEAT_INTERVAL_MS);
	}

	// 停止运行时心跳。
	private stopRuntimeStatusHeartbeat(): void {
		if (!this.runtimeStatusTimer) {
			return;
		}
		clearInterval(this.runtimeStatusTimer);
		this.runtimeStatusTimer = undefined;
	}

	// 写入运行时状态文件。
	private writeRuntimeStatus(
		runtimeStatus: Exclude<RuntimeStatus, 'idle'>,
		runtimeMessage: string,
		lastErrorMessage = '',
		lastDisconnect?: BridgeDisconnectSnapshot | null,
	): void {
		this.runtimeStatus = runtimeStatus;
		this.runtimeMessage = runtimeMessage;
		this.lastErrorMessage = lastErrorMessage;
		if (lastDisconnect !== undefined) {
			this.lastDisconnect = lastDisconnect;
		}
		const updatedAt = lastDisconnect
			? lastDisconnect.occurredAt
			: new Date().toISOString();

		const bridgeStatus = getBridgeStatus();
		const snapshot: RuntimeStatusSnapshot = {
			host: this.host,
			port: this.port,
			httpPort: this.httpPort > 0 ? this.httpPort : undefined,
			runtimeStatus,
			runtimeMessage,
			bridgeClientCount: bridgeStatus.connectedClients,
			bridgeClientIds: bridgeStatus.clientIds,
			bridgeLogs: DEBUG_SWITCH.enableSystemLog ? flushBridgeLogs() : [],
			bridgeVersionMismatch: this.lastVersionMismatch,
			lastErrorMessage,
			lastDisconnect: this.lastDisconnect,
			updatedAt,
		};
		writeRuntimeStatusSnapshot(this.statusFilePath, snapshot);
	}

	// 处理 stdio 单行 JSON-RPC 请求。
	private async handleStdioLine(line: string, write: (payload: unknown) => void): Promise<void> {
		const trimmed = String(line ?? '').trim();
		if (trimmed.length === 0) {
			return;
		}

		try {
			const request = this.rpcHandler.parseRequestBody(trimmed);
			const response = await this.rpcHandler.handleRequest(request);
			if (response !== null) {
				write(response);
			}
		}
		catch (error: unknown) {
			write(this.rpcHandler.createErrorResponse(null, -32700, toSafeErrorMessage(error)));
		}
	}

	// 输出运行日志到 stderr。
	private writeLog(
		level: UnifiedLogLevel,
		event: string,
		summary: string,
		message: string,
		extra: RuntimeLogExtra = {},
	): void {
		this.runtimeLogPipeline.write(level, event, summary, message, extra);
	}
}

// 读取命令行参数值。
function getArgValue(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index < 0 || index + 1 >= process.argv.length) {
		return undefined;
	}
	return process.argv[index + 1];
}

// 解析服务配置。
function getServerConfig(): { host: string; port: number } {
	const host = getArgValue(HOST_FLAG) ?? '127.0.0.1';
	const portRaw = getArgValue(PORT_FLAG) ?? '8765';
	const port = Number.parseInt(portRaw, 10);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`端口参数非法: ${portRaw}`);
	}
	return { host, port };
}

// 解析 HTTP MCP 传输端口，0 表示禁用。
function getHttpPort(): number {
	const httpPortRaw = getArgValue(HTTP_PORT_FLAG) ?? '0';
	const httpPort = Number.parseInt(httpPortRaw, 10);
	if (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65535) {
		return 0;
	}
	return httpPort;
}

// 读取状态文件参数。
function getStatusFilePath(): string {
	const statusFilePath = String(getArgValue(STATUS_FILE_PATH_FLAG) ?? '').trim();
	if (statusFilePath.length === 0) {
		throw new Error(`缺少运行时状态文件参数: ${STATUS_FILE_PATH_FLAG}`);
	}
	return statusFilePath;
}

// 读取扩展全局存储目录参数。
function getStorageDirectoryPath(): string {
	const storageDirectoryPath = String(getArgValue(STORAGE_DIRECTORY_FLAG) ?? '').trim();
	if (storageDirectoryPath.length === 0) {
		throw new Error(`缺少扩展存储目录参数: ${STORAGE_DIRECTORY_FLAG}`);
	}
	return storageDirectoryPath;
}

// 读取宿主会话标识参数。
function getSessionId(): string {
	const sessionId = String(getArgValue(SESSION_ID_FLAG) ?? '').trim();
	if (sessionId.length === 0) {
		throw new Error(`缺少宿主会话参数: ${SESSION_ID_FLAG}`);
	}
	return sessionId;
}

// 读取扩展版本参数。
function getExtensionVersion(): string {
	const extensionVersion = String(getArgValue(EXTENSION_VERSION_FLAG) ?? '').trim();
	if (extensionVersion.length === 0) {
		throw new Error(`缺少扩展版本参数: ${EXTENSION_VERSION_FLAG}`);
	}
	return extensionVersion;
}

	// 运行时启动入口。
function startRuntimeServer(): void {
	// 从 CLI 参数读取调试开关配置并应用。
	const enableSystemLog = getArgValue(DEBUG_ENABLE_SYSTEM_LOG_FLAG) !== 'false';
	const enableConnectionList = getArgValue(DEBUG_ENABLE_CONNECTION_LIST_FLAG) !== 'false';
	updateDebugSwitch({
		enableSystemLog,
		enableConnectionList,
		enableDebugControlCard: true,
	});
	const { host, port } = getServerConfig();
	const statusFilePath = getStatusFilePath();
	const storageDirectoryPath = getStorageDirectoryPath();
	const sessionId = getSessionId();
	const extensionVersion = getExtensionVersion();
	const agentInstructionsB64 = getArgValue(AGENT_INSTRUCTIONS_FLAG) ?? '';
	const agentInstructions = agentInstructionsB64.length > 0
		? Buffer.from(agentInstructionsB64, 'base64').toString('utf8')
		: '';
	clearSidebarInteractionRequest(storageDirectoryPath, sessionId);
	clearSidebarInteractionResponse(storageDirectoryPath, sessionId);
	const rawApiToolsFlagFilePath = path.join(storageDirectoryPath, `${sessionId}_raw_api_tools.flag`);
	// 从标志文件读取初始开关状态，由扩展主进程在启动前写入。
	const exposeRawApiTools = fs.existsSync(rawApiToolsFlagFilePath)
		? fs.readFileSync(rawApiToolsFlagFilePath, 'utf8').trim() === '1'
		: false;
	const toolDispatcher = new ToolDispatcher(storageDirectoryPath, sessionId, exposeRawApiTools);
	const rpcHandler = new RpcHandler(toolDispatcher, extensionVersion, agentInstructions);
	setServerVersion(extensionVersion);
	const httpPort = getHttpPort();
	const runtimeServer = new McpRuntimeServer(host, port, httpPort, rpcHandler, statusFilePath, toolDispatcher, rawApiToolsFlagFilePath);
	runtimeServer.start();
}

startRuntimeServer();
