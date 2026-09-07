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

import type { BridgeDebugSwitch, BridgeProtocolError, BridgeRole, BridgeServerRoleMessage, BridgeTaskEnvelope } from '../bridge/protocol.ts';
import type { UnifiedLogEntry } from '../logging/log.ts';
import extensionConfig from '../../extension.json';
import { getConfiguredMcpUrl, getMcpServerUrlChangedTopic } from '../bridge/config.ts';
import { toBridgeProtocolError } from '../bridge/protocol.ts';
import { BridgeLogDispatchPipeline } from '../logging/log-dispatch.ts';
import { bridgeLogPipeline } from '../logging/log.ts';
import * as bundledTaskModule from './task-module.ts';
import { HotUpdateManager } from './hot-update.ts';
import { BridgeStateManager } from '../state/state-manager.ts';
import { BridgeStatusReporter } from '../state/status-reporter.ts';
import { safeCall, toSafeErrorMessage, toSerializableAsync } from '../utils.ts';
import { BridgeTransport } from './bridge-transport.ts';

const RECONNECT_INTERVAL_MS = 1200;
const CONTEXT_SYNC_INTERVAL_MS = 1000;
const CONNECT_SUCCESS_TOAST_TIMER_SECONDS = 3;

const hotUpdate = new HotUpdateManager(bundledTaskModule, () => taskExecuting);

let started = false;
let connecting = false;
let clientId = '';
let transport: BridgeTransport | undefined;
let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
let contextSyncTimer: ReturnType<typeof globalThis.setInterval> | undefined;
let configSubscription: ISYS_MessageBusTask | null = null;
let taskChain: Promise<void> = Promise.resolve();
let taskExecuting = false;
let currentRole: BridgeRole = 'standby';
let currentLeaseTerm = 0;
let currentActiveClientId = '';
// 每次建立新连接时递增，确保每次调用 eda.sys_WebSocket.register 使用唯一 socketId。
let socketSequence = 0;

const statusReporter = new BridgeStatusReporter();
const bridgeLogDispatchPipeline = new BridgeLogDispatchPipeline();
const BRIDGE_STATUS_TEXT = BridgeStateManager.text;
const TASK_SLOW_LOG_THRESHOLD_MS = 3000;

function writeRuntimeWarningLog(event: string, summary: string, message: string, detail = '', errorCode = ''): void {
	const logEntry = bridgeLogPipeline.append(bridgeLogPipeline.createEntry({
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
	console.warn(bridgeLogPipeline.format(logEntry));
}

function createTaskLogDetail(task: BridgeTaskEnvelope, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		requestId: task.requestId,
		path: task.path,
		leaseTerm: task.leaseTerm,
		payloadKeys: task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload)
			? Object.keys(task.payload as Record<string, unknown>).sort()
			: [],
		...extra,
	});
}

function writeRuntimeTaskLog(level: 'info' | 'warning', event: string, summary: string, message: string, task: BridgeTaskEnvelope, extra: Record<string, unknown> = {}, errorCode = ''): void {
	const logEntry = bridgeLogPipeline.append(bridgeLogPipeline.createEntry({
		level,
		module: 'bridge-runtime',
		event,
		summary,
		message,
		bridgeWebSocketUrl: getConfiguredMcpUrl(),
		clientId: clientId || undefined,
		activeClientId: currentActiveClientId || undefined,
		leaseTerm: String(task.leaseTerm),
		detail: createTaskLogDetail(task, extra),
		errorCode,
	}));
	if (level === 'warning') {
		console.warn(bridgeLogPipeline.format(logEntry));
	}
}

// 显示桥接连接成功提示。
function showConnectSuccessToast(): void {
	try {
		eda.sys_Message.showToastMessage(BRIDGE_STATUS_TEXT.connection.connectSuccessToast, ESYS_ToastMessageType.SUCCESS, CONNECT_SUCCESS_TOAST_TIMER_SECONDS);
	}
	catch (error: unknown) {
		const message = toSafeErrorMessage(error);
		writeRuntimeWarningLog('status.connected.toast.failed', BRIDGE_STATUS_TEXT.runtime.connectedToastFailedSummary, message, message, 'status_connected_toast_failed');
	}
}

// 应用服务端下发的调试开关。
function applyDebugSwitch(debugSwitch: BridgeDebugSwitch): void {
	bridgeLogDispatchPipeline.setDebugSwitch(debugSwitch);
	bridgeLogDispatchPipeline.flushToTransport(transport);
}

// 追加客户端日志并尝试派发到服务端。
function enqueueBridgeLog(logEntry: UnifiedLogEntry): void {
	bridgeLogDispatchPipeline.enqueue(logEntry);
	bridgeLogDispatchPipeline.flushToTransport(transport);
}

// 生成稳定的客户端标识。
function getClientId(): string {
	if (clientId.length > 0) {
		return clientId;
	}

	clientId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
function enqueueTask(task: BridgeTaskEnvelope, currentTransport: BridgeTransport): void {
	if (taskExecuting) {
		currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, { code: 'BRIDGE_BUSY', message: '此前 EDA 调用仍未结束，本次未执行' });
		return;
	}
	taskExecuting = true;
	currentTransport.setExecutingTask(true);
	taskChain = taskChain.then(async () => {
		hotUpdate.current.setExecutionDeadline(task.deadlineAt);
		const taskStartedAt = Date.now();
		const queueDelayMs = Math.max(0, taskStartedAt - task.createdAt);
		writeRuntimeTaskLog('info', 'bridge.task.received', '桥接任务开始执行', `开始处理 ${task.path}`, task, {
			queueDelayMs,
		});

		if (currentRole !== 'active') {
			writeRuntimeTaskLog('warning', 'bridge.task.rejected.standby', '桥接任务被拒绝', BRIDGE_STATUS_TEXT.runtime.taskRejectedStandby, task, {}, 'bridge_task_rejected_standby');
			currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, {
				message: BRIDGE_STATUS_TEXT.runtime.taskRejectedStandby,
			});
			return;
		}

		if (task.leaseTerm !== currentLeaseTerm) {
			writeRuntimeTaskLog('warning', 'bridge.task.rejected.lease_expired', '桥接任务租约过期', BRIDGE_STATUS_TEXT.runtime.taskLeaseExpired, task, {
				currentLeaseTerm,
			}, 'bridge_task_lease_expired');
			currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, {
				message: BRIDGE_STATUS_TEXT.runtime.taskLeaseExpired,
			});
			return;
		}

		const handler = hotUpdate.current.handlers[task.path];
		if (!handler) {
			writeRuntimeTaskLog('warning', 'bridge.task.rejected.unsupported_path', '桥接任务路径不支持', `${BRIDGE_STATUS_TEXT.runtime.taskPathUnsupportedPrefix}${task.path}`, task, {}, 'bridge_task_path_unsupported');
			currentTransport.completeTask(task.requestId, task.leaseTerm, undefined, {
				message: `${BRIDGE_STATUS_TEXT.runtime.taskPathUnsupportedPrefix}${task.path}`,
			});
			return;
		}

		let result: unknown;
		let taskError: BridgeProtocolError | undefined;
		let handlerElapsedMs = 0;
		try {
			const handlerStartedAt = Date.now();
			if (task.deadlineAt && Date.now() >= task.deadlineAt)
				throw new Error('TASK_EXPIRED: 排队任务已过期，未执行');
			const rowsStatus = task.path === '/bridge/jlceda/schematic/place-rows' && (task.payload as { action?: string })?.action === 'status';
			if (task.targetDocumentUuid && !rowsStatus) {
				const document = await eda.dmt_SelectControl.getCurrentDocumentInfo();
				if (document?.uuid !== task.targetDocumentUuid)
					throw new Error('PAGE_CHANGE_DECLARATION_REQUIRED: 目标页面已切换；请重新显式声明 targetClientId 和 targetDocumentUuid，未执行');
				const expectedType = task.path.includes('/pcb/')
					? 3
					: task.path.includes('/schematic/') || task.path.includes('/component/place') ? 1 : undefined;
				if (expectedType !== undefined && document.documentType !== expectedType)
					throw new Error('DOCUMENT_TYPE_MISMATCH: 原理图/PCB 类型不匹配');
			}
			hotUpdate.current.setOwnershipGuard?.(() => started && transport === currentTransport && currentRole === 'active' && currentLeaseTerm === task.leaseTerm);
			const handlerResult = await handler(task.payload);
			if (task.path === '/bridge/jlceda/context' && handlerResult && typeof handlerResult === 'object')
				Object.assign(handlerResult, { hotUpdate: { ...hotUpdate.status } });
			handlerElapsedMs = Math.max(0, Date.now() - handlerStartedAt);
			const serializeStartedAt = Date.now();
			result = await toSerializableAsync(handlerResult);
			const serializeElapsedMs = Math.max(0, Date.now() - serializeStartedAt);
			const totalElapsedMs = Math.max(0, Date.now() - taskStartedAt);
			writeRuntimeTaskLog(totalElapsedMs >= TASK_SLOW_LOG_THRESHOLD_MS ? 'warning' : 'info', 'bridge.task.completed', '桥接任务执行完成', `任务 ${task.path} 已完成`, task, {
				queueDelayMs,
				handlerElapsedMs,
				serializeElapsedMs,
				totalElapsedMs,
				resultType: result == null ? 'nullish' : Array.isArray(result) ? 'array' : typeof result,
			}, totalElapsedMs >= TASK_SLOW_LOG_THRESHOLD_MS ? 'bridge_task_slow' : '');
		}
		catch (error: unknown) {
			const totalElapsedMs = Math.max(0, Date.now() - taskStartedAt);
			taskError = toBridgeProtocolError(error, toSafeErrorMessage(error));
			writeRuntimeTaskLog('warning', 'bridge.task.failed', BRIDGE_STATUS_TEXT.runtime.taskFailedSummary, toSafeErrorMessage(error), task, {
				queueDelayMs,
				handlerElapsedMs,
				totalElapsedMs,
				errorMessage: toSafeErrorMessage(error),
			}, 'bridge_task_failed');
		}

		currentTransport.completeTask(task.requestId, task.leaseTerm, result, taskError);
	}).catch((error: unknown) => {
		const message = toSafeErrorMessage(error);
		writeRuntimeWarningLog('bridge.task.failed', BRIDGE_STATUS_TEXT.runtime.taskFailedSummary, message, message, 'bridge_task_failed');
	}).finally(() => {
		taskExecuting = false;
		currentTransport.setExecutingTask(false);
		hotUpdate.current.setExecutionDeadline(undefined);
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
		bridgeLogDispatchPipeline.resetHandshakeState();
		await instance.connect();
		if (!started) {
			instance.close();
			return;
		}

		transport = instance;
		bridgeLogDispatchPipeline.flushToTransport(transport);
		// 先将当前页面身份写入 transport，再向服务端声明 ready。否则首次
		// context-sync 早于 transport 创建时，会出现“连接已就绪但无文档
		// 上下文”的短暂（甚至持续）状态，安全路由会正确拒绝该连接。
		await isEditablePage();
		// 只有运行时确认握手完成并接管实例后，才通知服务端允许调度任务。
		transport.reportReady();
		showConnectSuccessToast();
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
	const document = await safeCall(() => eda.dmt_SelectControl.getCurrentDocumentInfo());
	if (document && transport) {
		transport.updateContext({ documentUuid: document.uuid, documentType: document.documentType === 1 ? 'schematic' : document.documentType === 3 ? 'pcb' : 'other', title: document.documentType === 1 ? schPageInfo?.name ?? document.uuid : pcbInfo?.name ?? document.uuid, backgroundJob: hotUpdate.current.getBackgroundState?.() });
	}
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
	hotUpdate.start();
	bridgeLogPipeline.setListener((logEntry) => {
		enqueueBridgeLog(logEntry);
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

/** Release timers and sockets on extension unload; late async callbacks cannot reconnect. */
export function stopBridgeRuntime(): void {
	started = false;
	hotUpdate.stop();
	configSubscription?.cancel();
	configSubscription = null;
	clearReconnectTimer();
	clearContextSyncTimer();
	stopTransport();
	currentRole = 'standby';
	currentLeaseTerm = 0;
	currentActiveClientId = '';
}

export function getHotUpdateStatus(): unknown { return { ...hotUpdate.status }; }
export async function checkHotUpdate(): Promise<void> { await hotUpdate.check(); }
export function rollbackHotUpdate(): boolean { return hotUpdate.rollback(); }
