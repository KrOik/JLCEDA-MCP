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
	flushConnectorLogs,
	getBridgeStatus,
	notifyBridgeClientsDisconnect,
	pumpBridgeBroker,
	setBridgeDisconnectHandler,
	type BridgeDisconnectEvent,
} from './bridge/broker';
import { DEBUG_SWITCH, updateDebugSwitch } from '../debug';
import { STATUS_FILE_FLAG, writeRuntimeStatusSnapshot } from './core/runtime-status';
import type { BridgeDisconnectSnapshot, RuntimeStatus, RuntimeStatusSnapshot } from './core/status';
import { createRuntimeLogEntry, formatUnifiedLogOutput, SERVER_STATUS_TEXT, type UnifiedLogLevel } from '../status-log';
import { RpcHandler } from './mcp/rpc-handler';
import { ToolDispatcher } from './mcp/tool-dispatcher';
import { createStdioLineTransport } from './stdio/line-transport';
import { toSafeErrorMessage } from '../utils';
import { startBridgeWebSocketServer } from './websocket/bridge-server';

const HOST_FLAG = '--host';
const PORT_FLAG = '--port';
const STATUS_FILE_PATH_FLAG = STATUS_FILE_FLAG;
const EXTENSION_VERSION_FLAG = '--extension-version';
const AGENT_INSTRUCTIONS_FLAG = '--agent-instructions';
const DEBUG_ENABLE_SYSTEM_LOG_FLAG = '--enable-system-log';
const DEBUG_ENABLE_CONNECTION_LIST_FLAG = '--enable-connection-list';
const BRIDGE_WS_PATH = '/bridge/ws';
const RUNTIME_STATUS_HEARTBEAT_INTERVAL_MS = 1000;

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
	private runtimeMessage: string = SERVER_STATUS_TEXT.runtimeStarting;
	private lastErrorMessage = '';
	private lastDisconnect: BridgeDisconnectSnapshot | null = null;

	public constructor(
		private readonly host: string,
		private readonly port: number,
		private readonly rpcHandler: RpcHandler,
		private readonly statusFilePath: string,
	) {}

	/**
	 * 启动运行时服务。
	 */
	public start(): void {
		let shuttingDown = false;
		this.writeRuntimeStatus('starting', SERVER_STATUS_TEXT.runtimeStarting);
		setBridgeDisconnectHandler((event: BridgeDisconnectEvent) => {
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
				this.writeRuntimeStatus('running', SERVER_STATUS_TEXT.runtimeRunning);
				this.startRuntimeStatusHeartbeat();
				this.writeLog('success', 'runtime.bridge.listening', '桥接监听已就绪', `桥接已监听 ws://${this.host}:${this.port}${BRIDGE_WS_PATH}`);
			},
			onError: (error) => {
				const detailMessage = toRuntimeErrorMessage(error, this.host, this.port);
				this.stopRuntimeStatusHeartbeat();
				this.writeRuntimeStatus('error', SERVER_STATUS_TEXT.runtimeError, detailMessage);
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

		const shutdown = async (exitCode = 0, writeStoppedStatus = true): Promise<void> => {
			if (shuttingDown) {
				return;
			}
			shuttingDown = true;
			this.stopRuntimeStatusHeartbeat();
			if (writeStoppedStatus) {
				this.writeRuntimeStatus('stopped', SERVER_STATUS_TEXT.runtimeStopped);
			}

			await notifyBridgeClientsDisconnect(SERVER_STATUS_TEXT.bridgeDisconnectNotice);
			for (const client of bridgeWebSocketServer.server.clients) {
				client.close(1001, SERVER_STATUS_TEXT.serverClosingReason);
			}
			await bridgeWebSocketServer.close();
			setBridgeDisconnectHandler(undefined);
			this.writeLog('info', 'runtime.stopped', '服务已停止', SERVER_STATUS_TEXT.runtimeStopped, {
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
			runtimeStatus,
			runtimeMessage,
			bridgeClientCount: bridgeStatus.connectedClients,
			bridgeClientIds: bridgeStatus.clientIds,
			connectorLogs: DEBUG_SWITCH.enableSystemLog ? flushConnectorLogs() : [],
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
		extra: {
			runtimeStatus?: string;
			bridgeStatus?: string;
			contextKey?: string;
			leaseTerm?: string;
			bridgeClientCount?: string;
			detail?: string;
			errorCode?: string;
			clientId?: string;
			activeClientId?: string;
			disconnectType?: string;
			disconnectActor?: string;
			disconnectClientRole?: string;
			disconnectCloseCode?: string;
			disconnectCloseReason?: string;
			disconnectDurationMs?: string;
			disconnectOccurredAt?: string;
		} = {},
	): void {
		const entry = createRuntimeLogEntry({
			level,
			event,
			summary,
			message,
			host: this.host,
			port: this.port,
			runtimeStatus: extra.runtimeStatus,
			bridgeStatus: extra.bridgeStatus,
			contextKey: extra.contextKey,
			leaseTerm: extra.leaseTerm,
			bridgeClientCount: extra.bridgeClientCount,
			detail: extra.detail,
			errorCode: extra.errorCode,
			clientId: extra.clientId,
			activeClientId: extra.activeClientId,
			disconnectType: extra.disconnectType,
			disconnectActor: extra.disconnectActor,
			disconnectClientRole: extra.disconnectClientRole,
			disconnectCloseCode: extra.disconnectCloseCode,
			disconnectCloseReason: extra.disconnectCloseReason,
			disconnectDurationMs: extra.disconnectDurationMs,
			disconnectOccurredAt: extra.disconnectOccurredAt,
		});
		process.stderr.write(`${formatUnifiedLogOutput(entry)}\n`);
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

// 读取状态文件参数。
function getStatusFilePath(): string {
	const statusFilePath = String(getArgValue(STATUS_FILE_PATH_FLAG) ?? '').trim();
	if (statusFilePath.length === 0) {
		throw new Error(`缺少运行时状态文件参数: ${STATUS_FILE_PATH_FLAG}`);
	}
	return statusFilePath;
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
	const extensionVersion = getExtensionVersion();
	const agentInstructionsB64 = getArgValue(AGENT_INSTRUCTIONS_FLAG) ?? '';
	const agentInstructions = agentInstructionsB64.length > 0
		? Buffer.from(agentInstructionsB64, 'base64').toString('utf8')
		: '';
	const toolDispatcher = new ToolDispatcher();
	const rpcHandler = new RpcHandler(toolDispatcher, extensionVersion, agentInstructions);
	const runtimeServer = new McpRuntimeServer(host, port, rpcHandler, statusFilePath);
	runtimeServer.start();
}

startRuntimeServer();
