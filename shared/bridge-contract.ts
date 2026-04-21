/**
 * ------------------------------------------------------------------------
 * 名称：共享桥接契约定义
 * 说明：集中定义 MCP Hub 与 EDA Bridge 之间的跨端协议、错误模型与日志基础类型。
 * 原始协议作者：Lion
 * 共享契约重构：KrOik
 * 日期：2026-04-21
 * 备注：基于原协议定义抽取整理为 shared 单一事实源，禁止在两端重复手写同名契约。
 * ------------------------------------------------------------------------
 */

/**
 * 统一日志级别。
 */
export type UnifiedLogLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * 统一日志字段定义。
 */
export interface UnifiedLogFieldSchema {
	fieldOrder: string[];
	fieldLabels: Record<string, string>;
	defaultVisibleFields: string[];
}

/**
 * 统一日志记录结构。
 */
export interface UnifiedLogEntry {
	id: string;
	timestamp: string;
	level: UnifiedLogLevel;
	fields: Record<string, string>;
}

/**
 * 桥接角色，仅允许活动与待命两种。
 */
export type BridgeRole = 'active' | 'standby';

/**
 * 调试开关配置。
 */
export interface BridgeDebugSwitch {
	enableSystemLog: boolean;
	enableConnectionList: boolean;
}

/**
 * 标准化桥接错误结构。
 */
export interface BridgeProtocolError {
	message: string;
	code?: string;
	stack?: string;
	details?: Record<string, unknown>;
}

/**
 * 标准化任务载荷结构，Hub 队列与 Bridge 收包统一使用同一模型。
 */
export interface BridgeTaskEnvelope<TPayload = unknown> {
	requestId: string;
	path: string;
	payload: TPayload;
	createdAt: number;
	leaseTerm: number;
}

/**
 * 客户端上报握手消息。
 */
export interface BridgeClientHelloMessage {
	type: 'bridge/hello';
	clientId: string;
	bridgeVersion: string;
}

/**
 * 客户端上报心跳消息。
 */
export interface BridgeClientHeartbeatMessage {
	type: 'bridge/heartbeat';
	clientId: string;
	sentAt: number;
}

/**
 * 客户端回传任务执行结果。
 */
export interface BridgeClientResultMessage<TResult = unknown> {
	type: 'bridge/result';
	clientId: string;
	requestId: string;
	leaseTerm: number;
	result?: TResult;
	error?: BridgeProtocolError;
}

/**
 * 客户端上报日志消息。
 */
export interface BridgeClientLogMessage {
	type: 'bridge/log';
	clientId: string;
	log: UnifiedLogEntry;
}

/**
 * 客户端上报就绪消息。
 */
export interface BridgeClientReadyMessage {
	type: 'bridge/ready';
	clientId: string;
	readyAt: number;
}

/**
 * 服务端返回握手确认消息。
 */
export interface BridgeServerWelcomeMessage {
	type: 'bridge/welcome';
	clientId: string;
	connectedAt: string;
}

/**
 * 服务端下发角色更新消息。
 */
export interface BridgeServerRoleMessage {
	type: 'bridge/role';
	clientId: string;
	role: BridgeRole;
	leaseTerm: number;
	activeClientId: string;
	reason: string;
}

/**
 * 服务端下发调试开关消息。
 */
export interface BridgeServerDebugSwitchMessage {
	type: 'bridge/debug-switch';
	clientId: string;
	debugSwitch: BridgeDebugSwitch;
}

/**
 * 服务端返回心跳确认消息。
 */
export interface BridgeServerHeartbeatAckMessage {
	type: 'bridge/heartbeat-ack';
	clientId: string;
	sentAt: number;
	receivedAt: string;
}

/**
 * 服务端下发桥接任务消息。
 */
export interface BridgeServerTaskMessage<TPayload = unknown> extends BridgeTaskEnvelope<TPayload> {
	type: 'bridge/task';
}

/**
 * 服务端下发错误消息。
 */
export interface BridgeServerErrorMessage {
	type: 'bridge/error';
	message: string;
	requestId?: string;
}

export type BridgeClientMessage =
	| BridgeClientHelloMessage
	| BridgeClientHeartbeatMessage
	| BridgeClientResultMessage
	| BridgeClientLogMessage
	| BridgeClientReadyMessage;

export type BridgeServerMessage =
	| BridgeServerWelcomeMessage
	| BridgeServerRoleMessage
	| BridgeServerDebugSwitchMessage
	| BridgeServerHeartbeatAckMessage
	| BridgeServerTaskMessage
	| BridgeServerErrorMessage;

export const BRIDGE_CLIENT_MESSAGE_TYPES = [
	'bridge/hello',
	'bridge/heartbeat',
	'bridge/result',
	'bridge/log',
	'bridge/ready',
] as const satisfies BridgeClientMessage['type'][];

export const BRIDGE_SERVER_MESSAGE_TYPES = [
	'bridge/welcome',
	'bridge/role',
	'bridge/debug-switch',
	'bridge/heartbeat-ack',
	'bridge/task',
	'bridge/error',
] as const satisfies BridgeServerMessage['type'][];

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 统一规范未知错误到标准协议错误结构。
 * @param error 任意异常对象。
 * @param fallbackMessage 兜底错误文案。
 * @returns 标准化后的协议错误。
 */
export function toBridgeProtocolError(error: unknown, fallbackMessage = '未知桥接错误'): BridgeProtocolError {
	if (isBridgeProtocolError(error)) {
		return {
			message: error.message.trim() || fallbackMessage,
			code: typeof error.code === 'string' ? error.code.trim() || undefined : undefined,
			stack: typeof error.stack === 'string' ? error.stack : undefined,
			details: isPlainObjectRecord(error.details) ? { ...error.details } : undefined,
		};
	}

	if (error instanceof Error) {
		return {
			message: error.message.trim() || fallbackMessage,
			stack: error.stack,
		};
	}

	const normalizedMessage = String(error ?? '').trim();
	return {
		message: normalizedMessage.length > 0 ? normalizedMessage : fallbackMessage,
	};
}

/**
 * 判断日志级别是否有效。
 * @param value 待校验值。
 * @returns 是否为统一日志级别。
 */
export function isUnifiedLogLevel(value: unknown): value is UnifiedLogLevel {
	return value === 'info' || value === 'success' || value === 'warning' || value === 'error';
}

/**
 * 校验统一日志结构。
 * @param value 待校验对象。
 * @returns 是否为合法的 UnifiedLogEntry。
 */
export function isUnifiedLogEntry(value: unknown): value is UnifiedLogEntry {
	if (!isPlainObjectRecord(value)) {
		return false;
	}

	if (typeof value.id !== 'string' || value.id.trim().length === 0) {
		return false;
	}

	if (typeof value.timestamp !== 'string' || value.timestamp.trim().length === 0) {
		return false;
	}

	if (!isUnifiedLogLevel(value.level)) {
		return false;
	}

	if (!isPlainObjectRecord(value.fields)) {
		return false;
	}

	return Object.values(value.fields).every(fieldValue => typeof fieldValue === 'string');
}

/**
 * 校验桥接错误结构。
 * @param value 待校验对象。
 * @returns 是否为合法的 BridgeProtocolError。
 */
export function isBridgeProtocolError(value: unknown): value is BridgeProtocolError {
	if (!isPlainObjectRecord(value)) {
		return false;
	}

	if (typeof value.message !== 'string' || value.message.trim().length === 0) {
		return false;
	}

	if (value.code !== undefined && typeof value.code !== 'string') {
		return false;
	}

	if (value.stack !== undefined && typeof value.stack !== 'string') {
		return false;
	}

	if (value.details !== undefined && !isPlainObjectRecord(value.details)) {
		return false;
	}

	return true;
}

/**
 * 判断客户端消息类型是否有效。
 * @param value 待校验消息类型。
 * @returns 是否为合法的客户端消息类型。
 */
export function isBridgeClientMessageType(value: unknown): value is BridgeClientMessage['type'] {
	return typeof value === 'string' && BRIDGE_CLIENT_MESSAGE_TYPES.includes(value as BridgeClientMessage['type']);
}

/**
 * 判断服务端消息类型是否有效。
 * @param value 待校验消息类型。
 * @returns 是否为合法的服务端消息类型。
 */
export function isBridgeServerMessageType(value: unknown): value is BridgeServerMessage['type'] {
	return typeof value === 'string' && BRIDGE_SERVER_MESSAGE_TYPES.includes(value as BridgeServerMessage['type']);
}
