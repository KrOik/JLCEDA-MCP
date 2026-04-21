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
	type BridgeProtocolError,
	type BridgeServerMessage,
	type BridgeTaskEnvelope,
	isBridgeClientMessageType,
	isBridgeProtocolError,
} from './protocol';
import { DEBUG_SWITCH } from '../../debug';
import { BridgeLogPipeline } from '../../logging/bridge-log';
import type { UnifiedLogEntry } from '../../logging/server-log';
import { isUnifiedLogEntry } from '../../logging/server-log';
import { ServerStateManager } from '../../state/server-state-manager';
import { isPlainObjectRecord } from '../../utils';

interface BridgePeerState {
	clientId: string;
	connectedAt: number;
	lastSeenAt: number;
	isReady: boolean;
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
const BRIDGE_BROKER_TEXT = ServerStateManager.text.broker;

// 活动客户端等待超时专用错误，用于在 enqueueBridgeRequest 中精确识别等待超时。
class BridgePeerWaitTimeoutError extends Error {
	public constructor() {
		super(BRIDGE_BROKER_TEXT.wait.peerNotReadyError);
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
const bridgeLogPipeline = new BridgeLogPipeline();
let disconnectEventHandler: ((event: BridgeDisconnectEvent) => void) | undefined;
let versionMismatchHandler: ((event: BridgeVersionMismatchEvent) => void) | undefined;
let serverVersion = '';
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
	const timeoutReason = timeoutType === 'wait_active_peer'
		? BRIDGE_BROKER_TEXT.wait.waitActivePeerTimeoutReason
		: BRIDGE_BROKER_TEXT.wait.waitResultTimeoutReason;
	const message = timeoutType === 'wait_active_peer'
		? `${BRIDGE_BROKER_TEXT.wait.waitActivePeerTimeoutMessagePrefix}: ${path}`
		: `${BRIDGE_BROKER_TEXT.wait.waitResultTimeoutMessagePrefix}: ${path}`;

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
function normalizeDisconnectText(value: unknown, fallback = BRIDGE_BROKER_TEXT.connection.emptyFallback): string {
	const text = String(value ?? '').trim();
	return text.length > 0 ? text : fallback;
}

// 解析 close 回调中的原始原因。
function decodeCloseReason(reason: Buffer): string {
	return normalizeDisconnectText(reason.toString('utf8'), BRIDGE_BROKER_TEXT.connection.emptyFallback);
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
// 校验并解析客户端消息。
function parseClientMessage(data: RawData): BridgeClientMessage {
	const parsed = JSON.parse(decodeWebSocketData(data)) as unknown;
	if (!isPlainObjectRecord(parsed)) {
		throw new Error(BRIDGE_BROKER_TEXT.protocol.invalidMessageRoot);
	}

	const messageType = String(parsed.type ?? '').trim();
	if (messageType.length === 0) {
		throw new Error(BRIDGE_BROKER_TEXT.protocol.missingMessageType);
	}

	if (!isBridgeClientMessageType(messageType)) {
		throw new Error(`${BRIDGE_BROKER_TEXT.protocol.unknownClientMessageTypePrefix}: ${messageType}。`);
	}

	return parsed as unknown as BridgeClientMessage;
}

// 向客户端发送服务端消息。
function sendBridgeMessage(socket: WebSocket, message: BridgeServerMessage): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (socket.readyState !== WebSocket.OPEN) {
			reject(new Error(BRIDGE_BROKER_TEXT.connection.socketNotOpen));
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

// 获取当前已就绪的活动客户端。
function getReadyActivePeer(): BridgePeerState | undefined {
	const activePeer = getActivePeer();
	if (!activePeer || !activePeer.isReady) {
		return undefined;
	}

	return activePeer;
}

// 尝试唤醒等待活动客户端的调用。
function resolveActiveWaiters(): void {
	if (!getReadyActivePeer() || pendingActiveWaiters.size === 0) {
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

/**
 * 设置服务端版本号，在 broker 初始化时调用。
 * @param version 服务端扩展版本号。
 */
export function setServerVersion(version: string): void {
	serverVersion = String(version ?? '').trim();
}

// 客户端与服务端版本不一致事件。
export interface BridgeVersionMismatchEvent {
	bridgeVersion: string;
	serverVersion: string;
	lowerSide: 'bridge' | 'server';
}

/**
 * 设置版本不一致事件回调，由 runtime.ts 注册。
 * @param handler 版本不一致时的回调函数。
 */
export function setVersionMismatchHandler(handler: ((event: BridgeVersionMismatchEvent) => void) | undefined): void {
	versionMismatchHandler = handler;
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
		closeCode: Number.isInteger(context.closeCode) && Number(context.closeCode) > 0
			? String(context.closeCode)
			: BRIDGE_BROKER_TEXT.connection.emptyFallback,
		closeReason: normalizeDisconnectText(context.closeReason),
		detail: normalizeDisconnectText(reason),
		leaseTerm,
		connectedDurationMs,
		remainingClientCount: peersByClientId.size,
		occurredAt: new Date().toISOString(),
	});
}

// 定期清理失效客户端：WebSocket 连接不可用或心跳超时。
async function cleanupExpiredPeers(): Promise<void> {
	const current = nowMs();
	for (const peer of [...peersByClientId.values()]) {
		if (peer.socket.readyState !== WebSocket.OPEN) {
			await removeSocket(peer.socket, BRIDGE_BROKER_TEXT.connection.socketStateNotOpen, {
				disconnectType: 'socket_state_check',
				disconnectActor: 'runtime',
				closeReason: BRIDGE_BROKER_TEXT.connection.socketStateNotOpenReason,
			});
			continue;
		}

		if (current - peer.lastSeenAt > BRIDGE_CLIENT_TTL_MS) {
			await removeSocket(peer.socket, BRIDGE_BROKER_TEXT.connection.heartbeatTimeoutDetail, {
				disconnectType: 'heartbeat_timeout',
				disconnectActor: 'timeout',
				closeReason: BRIDGE_BROKER_TEXT.connection.heartbeatTimeoutReason,
			});
		}
	}
}

// 比较两个语义化版本字符串，返回负数表示 a < b，正数表示 a > b，0 表示相等。
function compareSemver(a: string, b: string): number {
	const parsePart = (v: string) => v.split('.').map(s => Number.parseInt(s, 10) || 0);
	const aParts = parsePart(a);
	const bParts = parsePart(b);
	for (let i = 0; i < 3; i++) {
		const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

// 检查客户端版本与服务端是否一致，不一致时触发回调。
function checkVersionMismatch(bridgeVer: string): void {
	if (!serverVersion || !bridgeVer || !versionMismatchHandler) {
		return;
	}
	const cmp = compareSemver(bridgeVer, serverVersion);
	if (cmp === 0) {
		return;
	}
	versionMismatchHandler({
		bridgeVersion: bridgeVer,
		serverVersion,
		lowerSide: cmp < 0 ? 'bridge' : 'server',
	});
}

// 注册或刷新客户端连接。
async function registerClient(clientId: string, socket: WebSocket): Promise<BridgePeerState> {
	const normalizedClientId = String(clientId ?? '').trim();
	if (normalizedClientId.length === 0) {
		throw new Error(BRIDGE_BROKER_TEXT.connection.missingClientId);
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
		isReady: isExistingSocketBinding ? existingPeer?.isReady ?? false : false,
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
		await broadcastRoles(BRIDGE_BROKER_TEXT.role.firstClientBecameActive);
	}
	else if (!isExistingSocketBinding) {
		await sendRoleToPeer(
			peer,
			peer.clientId === activeClientId
				? BRIDGE_BROKER_TEXT.role.activeRoleConfirmed
				: BRIDGE_BROKER_TEXT.role.enterStandbyRole,
		);
	}

	return peer;
}

// 等待活动客户端就绪。
async function waitForActivePeer(timeoutMs: number): Promise<void> {
	await cleanupExpiredPeers();
	if (getReadyActivePeer()) {
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
function completePendingRequest(message: { clientId: string; requestId: string; leaseTerm: number; result?: unknown; error?: BridgeProtocolError }): void {
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
		if (isBridgeProtocolError(message.error)) {
			pending.reject(new Error(message.error.message));
			return;
		}
		pending.reject(new Error(String(message.error)));
		return;
	}

	pending.resolve(message.result);
}

// 处理客户端消息。
async function handleClientMessage(socket: WebSocket, data: RawData): Promise<void> {
	const message = parseClientMessage(data);
	if (message.type === 'bridge/hello') {
		const peer = await registerClient(message.clientId, socket);
		const bridgeVer = String(message.bridgeVersion ?? '').trim();
		checkVersionMismatch(bridgeVer.length > 0 ? bridgeVer : BRIDGE_BROKER_TEXT.version.legacyClientWithoutVersion);
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

	if (message.type === 'bridge/ready') {
		const peer = await registerClient(message.clientId, socket);
		peer.lastSeenAt = nowMs();
		peer.isReady = true;
		resolveActiveWaiters();
		return;
	}

	if (message.type === 'bridge/log') {
		const peer = await registerClient(message.clientId, socket);
		peer.lastSeenAt = nowMs();
		if (!isUnifiedLogEntry(message.log)) {
			throw new Error(BRIDGE_BROKER_TEXT.protocol.invalidClientLogEntry);
		}

		bridgeLogPipeline.appendFromClient(message.log, getBridgeDebugSwitch());
		return;
	}

	throw new Error(BRIDGE_BROKER_TEXT.protocol.unsupportedBridgeMessageType);
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
		void removeSocket(socket, BRIDGE_BROKER_TEXT.connection.clientConnectionClosed, {
			disconnectType: isServerShuttingDown ? 'server_shutdown' : 'client_close',
			disconnectActor: isServerShuttingDown ? 'server' : 'client',
			closeCode: code,
			closeReason,
		});
	});

	socket.on('error', () => {
		void removeSocket(socket, BRIDGE_BROKER_TEXT.connection.clientConnectionInterrupted, {
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
		const readyActivePeer = getReadyActivePeer();
		if (!readyActivePeer) {
			continue;
		}
		if (!activePeer) {
			continue;
		}

		const currentLeaseTerm = leaseTerm;
		const requestId = createRequestId();
		const request: BridgeTaskEnvelope = {
			requestId,
			path,
			payload,
			createdAt: nowMs(),
			leaseTerm: currentLeaseTerm,
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
				clientId: readyActivePeer.clientId,
				leaseTerm: currentLeaseTerm,
				path,
			});
		});

		try {
			await sendBridgeMessage(readyActivePeer.socket, {
				type: 'bridge/task',
				...request,
			});
		}
		catch {
			const pending = pendingRequests.get(requestId);
			if (pending) {
				clearTimeout(pending.timer);
				pendingRequests.delete(requestId);
			}
			await removeSocket(readyActivePeer.socket, BRIDGE_BROKER_TEXT.connection.taskSendFailure, {
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
 * 取走当前心跳周期内积累的客户端日志并清空缓冲区。
 * @returns 本周期产生的日志数组。
 */
export function flushBridgeLogs(): UnifiedLogEntry[] {
	return bridgeLogPipeline.flush();
}

/**
 * 驱动桥接状态机前进，用于定时清理超时连接并执行补位选主。
 */
export async function pumpBridgeBroker(): Promise<void> {
	await cleanupExpiredPeers();
	await electActivePeer(BRIDGE_BROKER_TEXT.role.autoTakeoverAfterActiveOffline);
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
			throw new Error(BRIDGE_BROKER_TEXT.wait.buildBridgeReadyTimeoutMessage(timeoutMs));
		}
		throw error;
	}
}
