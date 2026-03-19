/**
 * ------------------------------------------------------------------------
 * 名称：桥接运行时管理器
 * 说明：维护连接生命周期、角色状态同步和桥接任务执行。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：按服务端裁决，仅在活动角色执行桥接任务。
 * ------------------------------------------------------------------------
 */

import type { BridgeDebugSwitch, BridgeRole, BridgeServerRoleMessage } from '../bridge/protocol.ts';
import type { UnifiedLogEntry } from '../status-log.ts';
import extensionConfig from '../../extension.json';
import { getConfiguredMcpUrl, getMcpServerUrlChangedTopic } from '../bridge/config.ts';
import { BridgeStatusReporter } from '../bridge/status-reporter.ts';
import { handleApiSearchTask } from '../mcp/api-search-handler.ts';
import { handleContextTask } from '../mcp/context-handler.ts';
import { handleInvokeTask } from '../mcp/invoke-handler.ts';
import {
	appendConnectorLog,
	CONNECTOR_STATUS_TEXT,
	createConnectorLogEntry,
	formatUnifiedLogOutput,
	isConnectionInfoLog,
	setConnectorLogListener,
} from '../status-log.ts';
import { safeCall, toSafeErrorMessage, toSerializableAsync } from '../utils';
import { BridgeTransport } from './bridge-transport.ts';

const RECONNECT_INTERVAL_MS = 1200;
const CONTEXT_SYNC_INTERVAL_MS = 1000;
const CONNECTOR_LOG_QUEUE_LIMIT = 200;
const CONNECTOR_LOG_DUP_WINDOW_MS = 1500;
const CONNECTOR_LOG_NOISE_WINDOW_MS = 8000;
const DEFAULT_DEBUG_SWITCH: BridgeDebugSwitch = {
	enableSystemLog: true,
	enableConnectionList: true,
};

const NOISE_LOG_EVENTS = new Set([
	'status.connecting',
	'status.failed',
	'status.bridge.waiting',
]);

const NOISE_LOG_MESSAGE_TOKENS = [
	'心跳',
	'重连',
	'无响应',
	'连接失败，系统将自动重试',
];

const BRIDGE_TASK_HANDLERS: Record<string, (payload: unknown) => Promise<unknown>> = {
	'/bridge/jlceda/api/search': handleApiSearchTask,
	'/bridge/jlceda/api/invoke': handleInvokeTask,
	'/bridge/jlceda/context/get': handleContextTask,
};

let started = false;
let connecting = false;
let clientId = '';
let transport: BridgeTransport | undefined;
let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let contextSyncTimer: ReturnType<typeof globalThis.setInterval> | undefined;
let configSubscription: ISYS_MessageBusTask | null = null;
let taskChain: Promise<void> = Promise.resolve();
let currentRole: BridgeRole = 'standby';
let currentLeaseTerm = 0;
let currentActiveClientId = '';
let currentDebugSwitch: BridgeDebugSwitch = { ...DEFAULT_DEBUG_SWITCH };
let hasReceivedDebugSwitch = false;
const pendingConnectorLogs: UnifiedLogEntry[] = [];
const connectorLogReportAtByKey = new Map<string, number>();
let flushingConnectorLogs = false;
// 每次建立新连接时递增，确保每次调用 eda.sys_WebSocket.register 使用唯一 socketId。
let socketSequence = 0;

const statusReporter = new BridgeStatusReporter();

function writeRuntimeWarningLog(event: string, summary: string, message: string, detail = '', errorCode = ''): void {
	const logEntry = appendConnectorLog(createConnectorLogEntry({
		level: 'warning',
		module: 'bridge-runtime',
		event,
		summary,
		message,
		bridgeWebSocketUrl: getConfiguredMcpUrl(),
		clientId: clientId || undefined,
		leaseTerm: String(currentLeaseTerm),
		detail,
		errorCode,
	}));
	console.warn(formatUnifiedLogOutput(logEntry));
}

// 生成日志去重键，避免高频重复上报。
function createConnectorLogKey(logEntry: UnifiedLogEntry): string {
	const fields = logEntry.fields;
	return [
		String(fields.module ?? '').trim(),
		String(fields.event ?? '').trim(),
		String(fields.summary ?? '').trim(),
		String(fields.message ?? '').trim(),
		String(fields.detail ?? '').trim(),
		String(fields.errorCode ?? '').trim(),
	].join('|');
}

// 判断当前日志是否属于高频噪音日志。
function isNoiseConnectorLog(logEntry: UnifiedLogEntry): boolean {
	const fields = logEntry.fields;
	const event = String(fields.event ?? '').trim();
	if (NOISE_LOG_EVENTS.has(event)) {
		return true;
	}

	const mergedText = [fields.summary, fields.message, fields.detail]
		.map(value => String(value ?? '').trim())
		.filter(value => value.length > 0)
		.join(' ');

	return NOISE_LOG_MESSAGE_TOKENS.some(token => mergedText.includes(token));
}

// 规范化服务端下发的调试开关。
function normalizeDebugSwitch(debugSwitch: BridgeDebugSwitch): BridgeDebugSwitch {
	return {
		enableSystemLog: debugSwitch.enableSystemLog !== false,
		enableConnectionList: debugSwitch.enableConnectionList !== false,
	};
}

// 应用服务端下发的调试开关。
function applyDebugSwitch(debugSwitch: BridgeDebugSwitch): void {
	hasReceivedDebugSwitch = true;
	currentDebugSwitch = normalizeDebugSwitch(debugSwitch);

	if (!currentDebugSwitch.enableSystemLog) {
		pendingConnectorLogs.splice(0, pendingConnectorLogs.length);
		connectorLogReportAtByKey.clear();
		return;
	}

	if (!currentDebugSwitch.enableConnectionList && pendingConnectorLogs.length > 0) {
		const filteredLogs = pendingConnectorLogs.filter(logEntry => !isConnectionInfoLog(logEntry));
		pendingConnectorLogs.splice(0, pendingConnectorLogs.length, ...filteredLogs);
	}

	flushConnectorLogs();
}

// 判断日志是否应被抑制，避免重复和噪音刷屏。
function shouldSuppressConnectorLog(logEntry: UnifiedLogEntry): boolean {
	const logKey = createConnectorLogKey(logEntry);
	if (logKey.length === 0) {
		return false;
	}

	const now = Date.now();
	const lastReportAt = connectorLogReportAtByKey.get(logKey) ?? 0;
	const throttleWindow = isNoiseConnectorLog(logEntry) ? CONNECTOR_LOG_NOISE_WINDOW_MS : CONNECTOR_LOG_DUP_WINDOW_MS;
	if (lastReportAt > 0 && now - lastReportAt < throttleWindow) {
		return true;
	}

	connectorLogReportAtByKey.set(logKey, now);
	if (connectorLogReportAtByKey.size > 800) {
		for (const [key, timestamp] of connectorLogReportAtByKey.entries()) {
			if (now - timestamp > CONNECTOR_LOG_NOISE_WINDOW_MS * 2) {
				connectorLogReportAtByKey.delete(key);
			}
		}
	}

	return false;
}

// 追加客户端日志到发送队列。
function enqueueConnectorLog(logEntry: UnifiedLogEntry): void {
	if (!currentDebugSwitch.enableSystemLog) {
		return;
	}

	if (!currentDebugSwitch.enableConnectionList && isConnectionInfoLog(logEntry)) {
		return;
	}

	if (shouldSuppressConnectorLog(logEntry)) {
		return;
	}

	pendingConnectorLogs.push(logEntry);
	if (pendingConnectorLogs.length > CONNECTOR_LOG_QUEUE_LIMIT) {
		pendingConnectorLogs.splice(0, pendingConnectorLogs.length - CONNECTOR_LOG_QUEUE_LIMIT);
	}

	flushConnectorLogs();
}

// 尝试将队列日志发送到服务端。
function flushConnectorLogs(): void {
	if (!hasReceivedDebugSwitch || flushingConnectorLogs || !transport || pendingConnectorLogs.length === 0) {
		return;
	}

	flushingConnectorLogs = true;
	try {
		while (pendingConnectorLogs.length > 0) {
			if (!transport) {
				break;
			}
			const nextLog = pendingConnectorLogs[0];
			transport.reportLog(nextLog);
			pendingConnectorLogs.shift();
		}
	}
	catch {
		// 发送失败时保留队列，等待后续重连再补发。
	}
	finally {
		flushingConnectorLogs = false;
	}
}

// 生成稳定的客户端标识。
function getClientId(): string {
	if (clientId.length > 0) {
		return clientId;
	}

	clientId = `connector_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	return clientId;
}

// 生成桥接 WebSocket 连接标识，序列号递增确保每次重连都使用全新 socketId，
// 防止 EDA API 因 socketId 相同而复用旧连接状态导致 onOpen 不触发。
function getSocketId(): string {
	socketSequence += 1;
	return `jlc_mcp_bridge_socket_${getClientId()}_${socketSequence}`;
}

// 清理重连定时器。
function clearReconnectTimer(): void {
	if (reconnectTimer !== undefined) {
		globalThis.clearTimeout(reconnectTimer);
		reconnectTimer = undefined;
	}
}

// 清理上下文同步定时器。
function clearContextSyncTimer(): void {
	if (contextSyncTimer !== undefined) {
		globalThis.clearInterval(contextSyncTimer);
		contextSyncTimer = undefined;
	}
}

// 断开当前连接。
function stopTransport(): void {
	connecting = false;
	if (transport) {
		transport.close();
		transport = undefined;
	}
}

// 按角色更新页面状态。
function applyRole(message: BridgeServerRoleMessage): void {
	currentRole = message.role;
	currentLeaseTerm = message.leaseTerm;
	currentActiveClientId = message.activeClientId;
	statusReporter.markRole(message.role, message.clientId, message.activeClientId);
}

// 调度任务执行并回传结果。
function enqueueTask(task: { requestId: string; path: string; payload: unknown; leaseTerm: number }, currentTransport: BridgeTransport): void {
	taskChain = taskChain.then(async () => {
		if (currentRole !== 'active') {
			currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, {
				message: CONNECTOR_STATUS_TEXT.taskRejectedStandby,
			});
			return;
		}

		if (task.leaseTerm !== currentLeaseTerm) {
			currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, {
				message: CONNECTOR_STATUS_TEXT.taskLeaseExpired,
			});
			return;
		}

		const handler = BRIDGE_TASK_HANDLERS[task.path];
		if (!handler) {
			currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, {
				message: `${CONNECTOR_STATUS_TEXT.taskPathUnsupportedPrefix}${task.path}`,
			});
			return;
		}

		let result: unknown;
		let taskError: { message: string; stack?: string } | undefined;
		try {
			result = await toSerializableAsync(await handler(task.payload));
		}
		catch (error: unknown) {
			taskError = {
				message: toSafeErrorMessage(error),
				stack: error instanceof Error ? error.stack : undefined,
			};
		}

		currentTransport.completeTask(task.requestId, task.leaseTerm, result, taskError);
	}).catch((error: unknown) => {
		const message = toSafeErrorMessage(error);
		writeRuntimeWarningLog('bridge.task.failed', CONNECTOR_STATUS_TEXT.taskFailedSummary, message, message, 'bridge_task_failed');
	});
}

// 建立桥接连接。
async function ensureConnected(): Promise<void> {
	if (!started || connecting || transport) {
		return;
	}

	connecting = true;
	statusReporter.markConnecting();
	const activeClientId = getClientId();
	const instance = new BridgeTransport(getConfiguredMcpUrl(), getSocketId(), activeClientId, String(extensionConfig.version), {
		onRoleChanged: (message) => {
			applyRole(message);
		},
		onDebugSwitchChanged: (debugSwitch) => {
			applyDebugSwitch(debugSwitch);
		},
		onTask: async (task) => {
			enqueueTask(task, instance);
		},
		onLost: (message) => {
			if (transport === instance) {
				transport = undefined;
			}
			connecting = false;
			if (!started) {
				return;
			}
			statusReporter.markFailed(message);
			scheduleReconnect();
		},
	});

	try {
		hasReceivedDebugSwitch = false;
		currentDebugSwitch = { ...DEFAULT_DEBUG_SWITCH };
		await instance.connect();
		if (!started) {
			instance.close();
			return;
		}

		transport = instance;
		flushConnectorLogs();
	}
	catch (error: unknown) {
		instance.close();
		statusReporter.markFailed(toSafeErrorMessage(error));
		scheduleReconnect();
	}
	finally {
		connecting = false;
	}
}

// 安排重连。
function scheduleReconnect(): void {
	if (!started || reconnectTimer !== undefined) {
		return;
	}

	reconnectTimer = globalThis.setTimeout(() => {
		reconnectTimer = undefined;
		void ensureConnected();
	}, RECONNECT_INTERVAL_MS);
}

// 触发配置切换后的重连。
function requestReconnectByConfigChange(): void {
	if (!started) {
		return;
	}

	clearReconnectTimer();
	stopTransport();
	currentRole = 'standby';
	currentLeaseTerm = 0;
	currentActiveClientId = '';
	void ensureConnected();
}

// 订阅配置更新。
function subscribeConfigChange(): void {
	if (configSubscription?.running()) {
		return;
	}

	configSubscription = eda.sys_MessageBus.subscribe(getMcpServerUrlChangedTopic(), (message: unknown) => {
		if (typeof message !== 'string' || message.trim().length === 0) {
			return;
		}
		requestReconnectByConfigChange();
	});
}

// 检查当前页面是否为原理图或 PCB 可编辑页。
async function isEditablePage(): Promise<boolean> {
	const [schPageInfo, pcbInfo] = await Promise.all([
		safeCall(() => eda.dmt_Schematic.getCurrentSchematicPageInfo()),
		safeCall(() => eda.dmt_Pcb.getCurrentPcbInfo()),
	]);
	return schPageInfo != null || pcbInfo != null;
}

// 周期同步页面上下文和连接状态。
function startContextSync(): void {
	clearContextSyncTimer();
	contextSyncTimer = globalThis.setInterval(() => {
		void isEditablePage().then((editable) => {
			if (editable) {
				// 在原理图或 PCB 页时正常维持连接。
				void ensureConnected();
				// 心跳刷新状态快照，让设置页的过期检测能区分活跃连接与历史遗留数据。
				if (transport && currentLeaseTerm > 0) {
					statusReporter.markRole(currentRole, getClientId(), currentActiveClientId);
				}
				else if (connecting) {
					statusReporter.markConnecting();
				}
			}
			else if (transport) {
				// 离开原理图/PCB 页时主动断开，避免首页无意义占用连接。
				clearReconnectTimer();
				stopTransport();
				currentRole = 'standby';
				currentLeaseTerm = 0;
				currentActiveClientId = '';
				statusReporter.markNotOnEditablePage();
			}
		}).catch(() => {
			// 页面类型检测失败时不做处理，下次同步时再试。
		});
	}, CONTEXT_SYNC_INTERVAL_MS);
}

/**
 * 启动桥接运行时。
 */
export function startBridgeRuntime(): void {
	if (started) {
		return;
	}

	started = true;
	setConnectorLogListener((logEntry) => {
		enqueueConnectorLog(logEntry);
	});
	subscribeConfigChange();
	startContextSync();
	// 启动时检查页面类型，仅在原理图或 PCB 页才立即发起连接。
	void isEditablePage().then((editable) => {
		if (editable) {
			void ensureConnected();
		}
	}).catch(() => {
		// 页面类型检测失败时跳过初次连接，由周期同步接管。
	});
}
