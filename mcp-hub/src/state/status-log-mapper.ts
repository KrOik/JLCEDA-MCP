/**
 * ------------------------------------------------------------------------
 * 名称：服务端状态日志映射器
 * 说明：将服务端状态快照映射为统一日志记录。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-21
 * 备注：仅处理状态到日志的映射，不处理日志输出。
 * ------------------------------------------------------------------------
 */

import { ServerStateManager } from './server-state-manager';
import type { BridgeDisconnectSnapshot, ServerStatus } from './status';
import {
	compactFields,
	createLogId,
	formatDisplayTime,
	normalizeText,
	type UnifiedLogEntry,
	type UnifiedLogLevel,
} from '../logging/server-log';

const STATUS_LOG_SUMMARY_MAX_LENGTH = 40;
const DISCONNECT_SNAPSHOT_VISIBLE_WINDOW_MS = 5000;

// 将运行时状态映射为短标签。
function toRuntimeStatusTag(runtimeStatus: ServerStatus['runtimeStatus']): string {
	if (runtimeStatus === 'running') {
		return '运行';
	}

	if (runtimeStatus === 'starting') {
		return '启动';
	}

	if (runtimeStatus === 'stopped') {
		return '停止';
	}

	if (runtimeStatus === 'error') {
		return '异常';
	}

	return '就绪';
}

// 将桥接状态映射为短标签。
function toBridgeStatusTag(bridgeStatus: ServerStatus['bridgeStatus']): string {
	if (bridgeStatus === 'connected') {
		return '已连';
	}

	if (bridgeStatus === 'error') {
		return '桥错';
	}

	return '等待';
}

// 将摘要裁剪到固定长度，避免日志字段过长。
function truncateSummary(text: string): string {
	if (text.length <= STATUS_LOG_SUMMARY_MAX_LENGTH) {
		return text;
	}

	return `${text.slice(0, Math.max(0, STATUS_LOG_SUMMARY_MAX_LENGTH - 1))}…`;
}

// 判断断开事件快照是否可用于日志输出。
function hasDisconnectSnapshot(snapshot: BridgeDisconnectSnapshot | null): snapshot is BridgeDisconnectSnapshot {
	return Boolean(snapshot && normalizeText(snapshot.eventId).length > 0);
}

// 获取当前状态对应的断开事件快照，断开发生后的 5 秒内持续可见。
function getCurrentDisconnectSnapshot(state: ServerStatus): BridgeDisconnectSnapshot | null {
	if (!hasDisconnectSnapshot(state.lastDisconnect)) {
		return null;
	}

	const occurredAt = Date.parse(normalizeText(state.lastDisconnect.occurredAt));
	if (!Number.isFinite(occurredAt)) {
		return null;
	}

	return Date.now() - occurredAt <= DISCONNECT_SNAPSHOT_VISIBLE_WINDOW_MS
		? state.lastDisconnect
		: null;
}

// 将断开发起方映射为中文标签。
function toDisconnectActorLabel(actor: BridgeDisconnectSnapshot['disconnectActor']): string {
	if (actor === 'client') {
		return '客户端';
	}

	if (actor === 'server') {
		return '服务端';
	}

	if (actor === 'timeout') {
		return '超时';
	}

	if (actor === 'network') {
		return '网络';
	}

	if (actor === 'runtime') {
		return '运行时';
	}

	return '未知';
}

// 按状态优先级生成摘要字段。
function createStatusSummary(state: ServerStatus): string {
	const runtimeMessage = normalizeText(state.runtimeMessage);

	if (state.runtimeStatus === 'error' || state.bridgeStatus === 'error') {
		return truncateSummary(runtimeMessage.length > 0 ? runtimeMessage : ServerStateManager.text.summary.errorFallback);
	}

	if (state.bridgeStatus === 'connected') {
		return ServerStateManager.text.summary.connected;
	}

	if (state.runtimeStatus === 'starting') {
		return ServerStateManager.text.summary.starting;
	}

	if (state.runtimeStatus === 'stopped') {
		return ServerStateManager.text.summary.stopped;
	}

	if (state.bridgeStatus === 'waiting') {
		return ServerStateManager.text.summary.waiting;
	}

	return truncateSummary(runtimeMessage.length > 0 ? runtimeMessage : ServerStateManager.text.summary.updated);
}

// 按状态优先级生成事件字段。
function createStatusEvent(state: ServerStatus): string {
	if (state.runtimeStatus === 'error' || state.bridgeStatus === 'error') {
		return 'status.error';
	}

	if (state.bridgeStatus === 'connected') {
		return 'status.bridge.connected';
	}

	if (state.runtimeStatus === 'starting') {
		return 'status.runtime.starting';
	}

	if (state.runtimeStatus === 'stopped') {
		return 'status.runtime.stopped';
	}

	if (state.bridgeStatus === 'waiting') {
		return 'status.bridge.waiting';
	}

	return 'status.updated';
}

// 按状态优先级生成日志级别。
function createStatusLogLevel(state: ServerStatus): UnifiedLogLevel {
	if (state.runtimeStatus === 'error' || state.bridgeStatus === 'error') {
		return 'error';
	}

	if (state.bridgeStatus === 'connected') {
		return 'success';
	}

	if (state.runtimeStatus === 'starting' || state.bridgeStatus === 'waiting') {
		return 'warning';
	}

	return 'info';
}

/**
 * 生成状态签名，用于去重连续相同状态日志。
 * @param state 当前服务端状态。
 * @param bridgeClientIds 当前已连接的客户端 ID 列表（首位为活动客户端）。
 * @returns 状态签名字符串。
 */
export function createServerStatusLogSignature(state: ServerStatus, bridgeClientIds: string[]): string {
	const disconnectSnapshot = getCurrentDisconnectSnapshot(state);
	return [
		state.runtimeStatus,
		state.runtimeMessage,
		state.bridgeStatus,
		state.bridgeMessage,
		bridgeClientIds.join(','),
		disconnectSnapshot ? disconnectSnapshot.eventId : '',
	].join('\n');
}

/**
 * 生成侧边栏状态日志记录。
 * @param state 当前服务端状态。
 * @param bridgeClientIds 当前已连接的客户端 ID 列表（首位为活动客户端）。
 * @returns 统一日志记录。
 */
export function createServerStatusLogEntry(state: ServerStatus, bridgeClientIds: string[], changedClientId = ''): UnifiedLogEntry {
	const timestamp = normalizeText(state.updatedAt) || new Date().toISOString();
	const displayTime = formatDisplayTime(timestamp);
	const disconnectSnapshot = getCurrentDisconnectSnapshot(state);
	const event = disconnectSnapshot
		? 'bridge.websocket.disconnected'
		: createStatusEvent(state);
	const summary = disconnectSnapshot
		? truncateSummary(`连接断开(${disconnectSnapshot.disconnectType})`)
		: createStatusSummary(state);
	const level = disconnectSnapshot
		? (disconnectSnapshot.disconnectType === 'socket_error' || disconnectSnapshot.disconnectType === 'send_failure' ? 'error' : 'warning')
		: createStatusLogLevel(state);
	const detail = disconnectSnapshot
		? normalizeText(disconnectSnapshot.detail)
		: '';
	const message = disconnectSnapshot
		? detail
		: (normalizeText(state.runtimeMessage) || normalizeText(state.bridgeMessage) || ServerStateManager.text.summary.updated);
	const clientId = disconnectSnapshot ? normalizeText(disconnectSnapshot.clientId) : changedClientId;
	const activeClientId = disconnectSnapshot ? '' : (bridgeClientIds[0] ?? '');
	const fields = compactFields({
		timestamp: displayTime,
		level,
		source: 'server',
		module: 'sidebar',
		event,
		summary,
		message,
		runtimeStatus: toRuntimeStatusTag(state.runtimeStatus),
		bridgeStatus: toBridgeStatusTag(state.bridgeStatus),
		bridgeWebSocketUrl: `ws://${state.host}:${state.port}/bridge/ws`,
		host: state.host,
		port: String(state.port),
		contextKey: 'global',
		bridgeClientCount: String(bridgeClientIds.length),
		clientId,
		activeClientId,
		leaseTerm: disconnectSnapshot ? String(disconnectSnapshot.leaseTerm) : '',
		disconnectType: disconnectSnapshot ? disconnectSnapshot.disconnectType : '',
		disconnectActor: disconnectSnapshot ? toDisconnectActorLabel(disconnectSnapshot.disconnectActor) : '',
		disconnectClientRole: disconnectSnapshot ? disconnectSnapshot.clientRole : '',
		disconnectCloseCode: disconnectSnapshot ? disconnectSnapshot.closeCode : '',
		disconnectCloseReason: disconnectSnapshot ? disconnectSnapshot.closeReason : '',
		disconnectDurationMs: disconnectSnapshot ? String(disconnectSnapshot.connectedDurationMs) : '',
		disconnectOccurredAt: disconnectSnapshot ? formatDisplayTime(disconnectSnapshot.occurredAt) : '',
		detail,
		errorCode: level === 'error'
			? (disconnectSnapshot ? `ws_disconnect_${disconnectSnapshot.disconnectType}` : 'runtime_or_bridge_error')
			: '',
	});

	return {
		id: createLogId(timestamp, event, state.host, state.port),
		timestamp,
		level,
		fields,
	};
}
