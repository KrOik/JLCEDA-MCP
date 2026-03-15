/**
 * ------------------------------------------------------------------------
 * 名称：桥接仲裁中心
 * 说明：维护客户端角色、租约、任务分发与结果回收。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：服务端仅裁决活动/待命角色，不主动踢掉待命连接。
 * ------------------------------------------------------------------------
 */

import WebSocket, { type RawData } from 'ws';
import {
	type BridgeClientMessage,
	type BridgeDebugSwitch,
	type BridgeQueueRequest,
	type BridgeServerMessage,
} from './protocol';
import { DEBUG_SWITCH } from '../../debug';
import type { UnifiedLogEntry } from '../../status-log';
import { isConnectionInfoLog, isUnifiedLogEntry } from '../../status-log';
import { isPlainObjectRecord } from '../../utils';

interface BridgePeerState {
	clientId: string;
	connectedAt: number;
	lastSeenAt: number;
	socket: WebSocket;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	timer: NodeJS.Timeout;
	clientId: string;
	leaseTerm: number;
	path: string;
}

interface PendingActiveWaiter {
	resolve: () => void;
	reject: (reason?: unknown) => void;
	timer: NodeJS.Timeout;
}

interface RemoveSocketContext {
	disconnectType: string;
	disconnectActor: 'client' | 'server' | 'timeout' | 'network' | 'runtime' | 'unknown';
	closeCode?: number;
	closeReason?: string;
}

export interface BridgeDisconnectEvent {
	eventId: string;
	clientId: string;
	clientRole: 'active' | 'standby' | 'unknown';
	disconnectType: string;
	disconnectActor: 'client' | 'server' | 'timeout' | 'network' | 'runtime' | 'unknown';
	closeCode: string;
	closeReason: string;
	detail: string;
	leaseTerm: number;
	connectedDurationMs: number;
	remainingClientCount: number;
	occurredAt: string;
}

interface BridgeRequestTimeoutResult {
	timeout: true;
	timeoutType: 'wait_active_peer' | 'wait_result';
	timeoutReason: string;
	path: string;
	message: string;
	timeoutMs: number;
	elapsedMs: number;
}

const BRIDGE_CLIENT_TTL_MS = 8_000;
const BRIDGE_CONNECTOR_LOG_LIMIT = 200;

// 活动客户端等待超时专用错误，用于在 enqueueBridgeRequest 中精确识别等待超时。
class BridgePeerWaitTimeoutError extends Error {
	public constructor() {
		super('EDA 桥接客户端未就绪。');
		this.name = 'BridgePeerWaitTimeoutError';
	}
}

let requestSequence = 0;
let disconnectSequence = 0;
let leaseTerm = 0;
let activeClientId = '';
const peersByClientId = new Map<string, BridgePeerState>();
const clientIdBySocket = new Map<WebSocket, string>();
const pendingRequests = new Map<string, PendingRequest>();
const pendingActiveWaiters = new Set<PendingActiveWaiter>();
// 增量日志缓冲：每次 flush 后清空，只保留当前心跳周期产生的新日志。
const pendingConnectorLogs: UnifiedLogEntry[] = [];
let disconnectEventHandler: ((event: BridgeDisconnectEvent) => void) | undefined;
let isServerShuttingDown = false;
let lastCleanupAt = 0;

// 读取当前调试开关快照。
function getBridgeDebugSwitch(): BridgeDebugSwitch {
	return {
		enableSystemLog: DEBUG_SWITCH.enableSystemLog,
		enableConnectionList: DEBUG_SWITCH.enableConnectionList,
	};
}

function nowMs(): number {
	return Date.now();
}

// 构建桥接超时业务结果。
function createBridgeRequestTimeoutResult(
	path: string,
	timeoutType: 'wait_active_peer' | 'wait_result',
	timeoutMs: number,
	startedAt: number,
): BridgeRequestTimeoutResult {
	const timeoutReason = timeoutType === 'wait_active_peer' ? '等待活动客户端超时' : '等待桥接回包超时';
	const message = timeoutType === 'wait_active_peer'
		? `桥接请求超时（等待活动客户端）: ${path}`
		: `桥接请求超时（等待桥接回包）: ${path}`;

	return {
		timeout: true,
		timeoutType,
		timeoutReason,
		path,
		message,
		timeoutMs,
		elapsedMs: Math.max(0, nowMs() - startedAt),
	};
}

// 生成单调递增的请求标识。
function createRequestId(): string {
	requestSequence += 1;
	return `bridge_req_${Date.now()}_${requestSequence}`;
}

// 生成断开事件唯一标识。
function createDisconnectEventId(clientId: string, disconnectType: string): string {
	disconnectSequence += 1;
	return `bridge_disconnect_${Date.now()}_${disconnectSequence}_${clientId}_${disconnectType}`;
}

// 规范化断开相关文本。
function normalizeDisconnectText(value: unknown, fallback = '无'): string {
	const text = String(value ?? '').trim();
	return text.length > 0 ? text : fallback;
}

// 解析 close 回调中的原始原因。
function decodeCloseReason(reason: Buffer): string {
	return normalizeDisconnectText(reason.toString('utf8'), '无');
}

// 解析 websocket 原始消息。
function decodeWebSocketData(data: RawData): string {
	if (typeof data === 'string') {
		return data;
	}
	if (Buffer.isBuffer(data)) {
		return data.toString('utf8');
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data).toString('utf8');
	}
	return Buffer.from(data).toString('utf8');
}

// 客户端允许发出的消息类型白名单。
const VALID_CLIENT_MESSAGE_TYPES = new Set([
	'bridge/hello',
	'bridge/heartbeat',
	'bridge/result',
	'bridge/log',
]);

// 校验并解析客户端消息。
function parseClientMessage(data: RawData): BridgeClientMessage {
	const parsed = JSON.parse(decodeWebSocketData(data)) as unknown;
	if (!isPlainObjectRecord(parsed)) {
		throw new Error('桥接消息格式非法，根节点必须是对象。');
	}

	const messageType = String(parsed.type ?? '').trim();
	if (messageType.length === 0) {
		throw new Error('桥接消息缺少 type 字段。');
	}

	if (!VALID_CLIENT_MESSAGE_TYPES.has(messageType)) {
		throw new Error(`收到未知客户端消息类型: ${messageType}。`);
	}

	return parsed as unknown as BridgeClientMessage;
}

// 追加连接器日志到增量缓冲区，限制上限防止连接器日志暴涨。
function appendConnectorLog(logEntry: UnifiedLogEntry): void {
	pendingConnectorLogs.push(logEntry);
	if (pendingConnectorLogs.length > BRIDGE_CONNECTOR_LOG_LIMIT) {
		pendingConnectorLogs.splice(0, pendingConnectorLogs.length - BRIDGE_CONNECTOR_LOG_LIMIT);
	}
}

// 向客户端发送服务端消息。
function sendBridgeMessage(socket: WebSocket, message: BridgeServerMessage): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (socket.readyState !== WebSocket.OPEN) {
			reject(new Error('桥接连接未打开。'));
			return;
		}

		socket.send(JSON.stringify(message), (error?: Error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

// 发送错误消息。
async function sendBridgeError(socket: WebSocket, message: string, requestId?: string): Promise<void> {
	try {
		await sendBridgeMessage(socket, {
			type: 'bridge/error',
			message,
			requestId,
		});
	}
	catch {
		// 错误消息发送失败时不再抛出。
	}
}

// 获取当前活动客户端。
function getActivePeer(): BridgePeerState | undefined {
	if (activeClientId.length === 0) {
		return undefined;
	}
	const peer = peersByClientId.get(activeClientId);
	if (!peer) {
		activeClientId = '';
	}
	return peer;
}

// 尝试唤醒等待活动客户端的调用。
function resolveActiveWaiters(): void {
	if (!getActivePeer() || pendingActiveWaiters.size === 0) {
		return;
	}

	for (const waiter of pendingActiveWaiters) {
		clearTimeout(waiter.timer);
		pendingActiveWaiters.delete(waiter);
		waiter.resolve();
	}
}

// 拒绝指定客户端的挂起请求。
function rejectPendingRequestsByClient(clientId: string, reason: string): void {
	for (const [requestId, pending] of pendingRequests.entries()) {
		if (pending.clientId !== clientId) {
			continue;
		}

		clearTimeout(pending.timer);
		pendingRequests.delete(requestId);
		pending.reject(new Error(reason));
	}
}

// 向指定客户端下发角色状态。
async function sendRoleToPeer(peer: BridgePeerState, reason: string): Promise<void> {
	const role = peer.clientId === activeClientId ? 'active' : 'standby';
	await sendBridgeMessage(peer.socket, {
		type: 'bridge/role',
		clientId: peer.clientId,
		role,
		leaseTerm,
		activeClientId,
		reason,
	});
}

// 向指定客户端下发调试开关。
async function sendDebugSwitchToPeer(peer: BridgePeerState): Promise<void> {
	await sendBridgeMessage(peer.socket, {
		type: 'bridge/debug-switch',
		clientId: peer.clientId,
		debugSwitch: getBridgeDebugSwitch(),
	});
}

// 广播角色状态到全部在线客户端。
async function broadcastRoles(reason: string): Promise<void> {
	const tasks: Array<Promise<void>> = [];
	for (const peer of peersByClientId.values()) {
		tasks.push(sendRoleToPeer(peer, reason));
	}

	await Promise.allSettled(tasks);
}

// 从待命集合中选举新的活动客户端。
async function electActivePeer(reason: string): Promise<void> {
	const currentActive = getActivePeer();
	if (currentActive) {
		return;
	}

	const candidates = [...peersByClientId.values()].sort((left, right) => {
		if (left.connectedAt !== right.connectedAt) {
			return left.connectedAt - right.connectedAt;
		}
		return left.clientId.localeCompare(right.clientId);
	});

	if (candidates.length === 0) {
		activeClientId = '';
		return;
	}

	activeClientId = candidates[0].clientId;
	leaseTerm += 1;
	resolveActiveWaiters();
	await broadcastRoles(reason);
}

// 设置断开事件回调。
export function setBridgeDisconnectHandler(handler: ((event: BridgeDisconnectEvent) => void) | undefined): void {
	disconnectEventHandler = handler;
}

// 释放 socket 与 clientId 绑定。
function unbindSocket(socket: WebSocket): string {
	const clientId = clientIdBySocket.get(socket);
	if (!clientId) {
		return '';
	}

	clientIdBySocket.delete(socket);
	const peer = peersByClientId.get(clientId);
	if (peer?.socket === socket) {
		peersByClientId.delete(clientId);
	}

	return clientId;
}

// 移除连接并触发重新选主。
async function removeSocket(socket: WebSocket, reason: string, context: RemoveSocketContext): Promise<void> {
	const targetClientId = clientIdBySocket.get(socket) ?? '';
	const targetPeer = targetClientId.length > 0 ? peersByClientId.get(targetClientId) : undefined;
	const clientRole: 'active' | 'standby' | 'unknown' = targetClientId.length === 0
		? 'unknown'
		: (targetClientId === activeClientId ? 'active' : 'standby');
	const connectedDurationMs = targetPeer ? Math.max(0, nowMs() - targetPeer.connectedAt) : 0;

	const clientId = unbindSocket(socket);
	if (clientId.length === 0) {
		return;
	}

	if (clientId === activeClientId) {
		activeClientId = '';
		rejectPendingRequestsByClient(clientId, reason);
	}

	await electActivePeer(reason);

	disconnectEventHandler?.({
		eventId: createDisconnectEventId(clientId, context.disconnectType),
		clientId,
		clientRole,
		disconnectType: context.disconnectType,
		disconnectActor: context.disconnectActor,
		closeCode: Number.isInteger(context.closeCode) && Number(context.closeCode) > 0 ? String(context.closeCode) : '无',
		closeReason: normalizeDisconnectText(context.closeReason),
		detail: normalizeDisconnectText(reason),
		leaseTerm,
		connectedDurationMs,
		remainingClientCount: peersByClientId.size,
		occurredAt: new Date().toISOString(),
	});
}

// 定期清理心跳超时客户端。
async function cleanupExpiredPeers(): Promise<void> {
	const current = nowMs();
	for (const peer of [...peersByClientId.values()]) {
		if (current - peer.lastSeenAt <= BRIDGE_CLIENT_TTL_MS) {
			continue;
		}

		await removeSocket(peer.socket, `桥接客户端心跳超时：${peer.clientId}`, {
			disconnectType: 'heartbeat_timeout',
			disconnectActor: 'timeout',
			closeReason: '心跳超时',
		});
	}
}

// 注册或刷新客户端连接。
async function registerClient(clientId: string, socket: WebSocket): Promise<BridgePeerState> {
	const normalizedClientId = String(clientId ?? '').trim();
	if (normalizedClientId.length === 0) {
		throw new Error('桥接客户端缺少 clientId。');
	}

	const current = nowMs();
	const existingPeer = peersByClientId.get(normalizedClientId);
	const isExistingSocketBinding = Boolean(existingPeer && existingPeer.socket === socket);
	if (existingPeer && existingPeer.socket !== socket) {
		clientIdBySocket.delete(existingPeer.socket);
	}

	const peer: BridgePeerState = {
		clientId: normalizedClientId,
		connectedAt: existingPeer?.connectedAt ?? current,
		lastSeenAt: current,
		socket,
	};
	peersByClientId.set(normalizedClientId, peer);
	clientIdBySocket.set(socket, normalizedClientId);

	const currentMs = Date.now();
	if (currentMs - lastCleanupAt > 2000) {
		lastCleanupAt = currentMs;
		await cleanupExpiredPeers();
	}
	if (!getActivePeer()) {
		activeClientId = normalizedClientId;
		leaseTerm += 1;
		resolveActiveWaiters();
		await broadcastRoles('首个连接已成为活动客户端。');
	}
	else if (!isExistingSocketBinding) {
		await sendRoleToPeer(peer, peer.clientId === activeClientId ? '活动客户端状态已确认。' : '当前客户端进入待命状态。');
	}

	return peer;
}

// 等待活动客户端就绪。
async function waitForActivePeer(timeoutMs: number): Promise<void> {
	await cleanupExpiredPeers();
	if (getActivePeer()) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const waiter: PendingActiveWaiter = {
			resolve: () => {
				resolve();
			},
			reject: (reason?: unknown) => {
				reject(reason);
			},
			timer: setTimeout(() => {
				pendingActiveWaiters.delete(waiter);
			reject(new BridgePeerWaitTimeoutError());
			}, timeoutMs),
		};

		pendingActiveWaiters.add(waiter);
		void cleanupExpiredPeers().then(() => {
			resolveActiveWaiters();
		});
	});
}

// 完成请求回调。
function completePendingRequest(message: { clientId: string; requestId: string; leaseTerm: number; result?: unknown; error?: unknown }): void {
	const pending = pendingRequests.get(message.requestId);
	if (!pending) {
		return;
	}

	if (pending.clientId !== message.clientId || pending.leaseTerm !== message.leaseTerm) {
		return;
	}

	clearTimeout(pending.timer);
	pendingRequests.delete(message.requestId);
	if (message.error !== undefined && message.error !== null) {
		if (isPlainObjectRecord(message.error) && typeof message.error.message === 'string') {
			pending.reject(new Error(message.error.message));
			return;
		}
		pending.reject(message.error);
		return;
	}

	pending.resolve(message.result);
}

// 处理客户端消息。
async function handleClientMessage(socket: WebSocket, data: RawData): Promise<void> {
	const message = parseClientMessage(data);
	if (message.type === 'bridge/hello') {
		const peer = await registerClient(message.clientId, socket);
		await sendBridgeMessage(peer.socket, {
			type: 'bridge/welcome',
			clientId: peer.clientId,
			connectedAt: new Date(peer.connectedAt).toISOString(),
		});
		await sendDebugSwitchToPeer(peer);
		return;
	}

	if (message.type === 'bridge/heartbeat') {
		const peer = await registerClient(message.clientId, socket);
		peer.lastSeenAt = nowMs();
		await sendBridgeMessage(peer.socket, {
			type: 'bridge/heartbeat-ack',
			clientId: peer.clientId,
			sentAt: message.sentAt,
			receivedAt: new Date(peer.lastSeenAt).toISOString(),
		});
		return;
	}

	if (message.type === 'bridge/result') {
		const peer = await registerClient(message.clientId, socket);
		peer.lastSeenAt = nowMs();
		completePendingRequest({
			clientId: peer.clientId,
			requestId: String(message.requestId ?? '').trim(),
			leaseTerm: Number(message.leaseTerm ?? 0),
			result: message.result,
			error: message.error,
		});
		return;
	}

	if (message.type === 'bridge/log') {
		const peer = await registerClient(message.clientId, socket);
		peer.lastSeenAt = nowMs();
		if (!DEBUG_SWITCH.enableSystemLog) {
			return;
		}
		if (!isUnifiedLogEntry(message.log)) {
			throw new Error('客户端日志结构非法。');
		}
		if (!DEBUG_SWITCH.enableConnectionList && isConnectionInfoLog(message.log)) {
			return;
		}

		appendConnectorLog(message.log);
		return;
	}

	throw new Error('不支持的桥接消息类型。');
}

/**
 * 绑定桥接客户端 websocket 连接。
 * @param socket 已升级完成的 websocket。
 */
export function attachBridgeClientSocket(socket: WebSocket): void {
	socket.on('message', (data: RawData) => {
		void handleClientMessage(socket, data).catch(async (error: unknown) => {
			await sendBridgeError(socket, error instanceof Error ? error.message : String(error));
		});
	});

	socket.on('close', (code: number, reason: Buffer) => {
		const closeReason = decodeCloseReason(reason);
		void removeSocket(socket, '桥接客户端连接已关闭。', {
			disconnectType: isServerShuttingDown ? 'server_shutdown' : 'client_close',
			disconnectActor: isServerShuttingDown ? 'server' : 'client',
			closeCode: code,
			closeReason,
		});
	});

	socket.on('error', () => {
		void removeSocket(socket, '桥接客户端连接异常中断。', {
			disconnectType: 'socket_error',
			disconnectActor: 'network',
			closeReason: 'socket_error',
		});
	});
}

/**
 * 提交桥接任务并等待活动客户端处理。
 * @param path 桥接路径。
 * @param payload 请求体。
 * @param timeoutMs 超时时间。
 * @returns 桥接响应结果。
 */
export async function enqueueBridgeRequest(path: string, payload: unknown, timeoutMs: number): Promise<unknown | BridgeRequestTimeoutResult> {
	const startedAt = nowMs();
	const deadlineAt = startedAt + timeoutMs;
	while (true) {
		const waitTimeout = deadlineAt - nowMs();
		if (waitTimeout <= 0) {
			return createBridgeRequestTimeoutResult(path, 'wait_active_peer', timeoutMs, startedAt);
		}

		try {
			await waitForActivePeer(waitTimeout);
		}
		catch (error: unknown) {
			if (error instanceof BridgePeerWaitTimeoutError) {
				return createBridgeRequestTimeoutResult(path, 'wait_active_peer', timeoutMs, startedAt);
			}
			throw error;
		}
		const activePeer = getActivePeer();
		if (!activePeer) {
			continue;
		}

		const currentLeaseTerm = leaseTerm;
		const requestId = createRequestId();
		const request: BridgeQueueRequest = {
			requestId,
			path,
			payload,
			createdAt: nowMs(),
		};

		const resultPromise = new Promise<unknown | BridgeRequestTimeoutResult>((resolve, reject) => {
			const remaining = deadlineAt - nowMs();
			const timer = setTimeout(() => {
				pendingRequests.delete(requestId);
				resolve(createBridgeRequestTimeoutResult(path, 'wait_result', timeoutMs, startedAt));
			}, remaining);

			pendingRequests.set(requestId, {
				resolve,
				reject,
				timer,
				clientId: activePeer.clientId,
				leaseTerm: currentLeaseTerm,
				path,
			});
		});

		try {
			await sendBridgeMessage(activePeer.socket, {
				type: 'bridge/task',
				requestId: request.requestId,
				path: request.path,
				payload: request.payload,
				createdAt: request.createdAt,
				leaseTerm: currentLeaseTerm,
			});
		}
		catch {
			const pending = pendingRequests.get(requestId);
			if (pending) {
				clearTimeout(pending.timer);
				pendingRequests.delete(requestId);
			}
			await removeSocket(activePeer.socket, '桥接任务发送失败，活动客户端已下线。', {
				disconnectType: 'send_failure',
				disconnectActor: 'runtime',
				closeReason: 'bridge_task_send_failed',
			});
			continue;
		}

		return await resultPromise;
	}
}

/**
 * 获取桥接状态快照。
 * @returns 当前桥接状态摘要。
 */
export function getBridgeStatus(): { connectedClients: number; pendingRequests: number; clientIds: string[] } {
	const clientIds = [...peersByClientId.keys()].sort((left, right) => left.localeCompare(right));
	if (activeClientId.length > 0) {
		const index = clientIds.indexOf(activeClientId);
		if (index > 0) {
			clientIds.splice(index, 1);
			clientIds.unshift(activeClientId);
		}
	}

	return {
		connectedClients: clientIds.length,
		pendingRequests: pendingRequests.size,
		clientIds,
	};
}

/**
 * 取走当前心跳周期内积累的连接器日志并清空缓冲区。
 * @returns 本周期产生的日志数组。
 */
export function flushConnectorLogs(): UnifiedLogEntry[] {
	const flushed = pendingConnectorLogs.slice();
	pendingConnectorLogs.splice(0, pendingConnectorLogs.length);
	return flushed;
}

/**
 * 驱动桥接状态机前进，用于定时清理超时连接并执行补位选主。
 */
export async function pumpBridgeBroker(): Promise<void> {
	await cleanupExpiredPeers();
	await electActivePeer('活动客户端离线，已从待命客户端自动接管。');
}

/**
 * 向所有在线客户端广播服务端通知。
 * @param message 提示文本。
 */
export async function notifyBridgeClientsDisconnect(message: string): Promise<void> {
	isServerShuttingDown = true;
	const tasks: Array<Promise<void>> = [];
	for (const peer of peersByClientId.values()) {
		tasks.push(sendBridgeMessage(peer.socket, {
			type: 'bridge/error',
			message,
		}));
	}
	await Promise.allSettled(tasks);
}

/**
 * 等待桥接活动客户端就绪。
 * @param timeoutMs 最长等待时间（毫秒），超时后抛出 Error。
 */
export async function waitForBridgeReady(timeoutMs: number): Promise<void> {
	try {
		await waitForActivePeer(timeoutMs);
	}
	catch (error: unknown) {
		if (error instanceof BridgePeerWaitTimeoutError) {
			throw new Error(`EDA 连接器未连接，等待 ${timeoutMs} ms 超时。请在嘉立创 EDA 专业版中打开任意工程后重试。`);
		}
		throw error;
	}
}
