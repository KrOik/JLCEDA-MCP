/**
 * ------------------------------------------------------------------------
 * 名称：服务端日志主管道
 * 说明：统一管理服务端日志模型、字段定义、日志构建与格式化。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-21
 * 备注：仅处理日志模型与格式，不包含状态推导逻辑。
 * ------------------------------------------------------------------------
 */

import type {
	UnifiedLogEntry,
	UnifiedLogFieldSchema,
	UnifiedLogLevel,
} from '../../../shared/bridge-contract';

export type {
	UnifiedLogEntry,
	UnifiedLogFieldSchema,
	UnifiedLogLevel,
} from '../../../shared/bridge-contract';

export { isUnifiedLogEntry } from '../../../shared/bridge-contract';

const LOG_FIELD_ORDER = [
	'timestamp',
	'level',
	'source',
	'module',
	'event',
	'summary',
	'message',
	'runtimeStatus',
	'bridgeStatus',
	'bridgeWebSocketUrl',
	'host',
	'port',
	'contextKey',
	'clientId',
	'activeClientId',
	'leaseTerm',
	'bridgeClientCount',
	'disconnectType',
	'disconnectActor',
	'disconnectClientRole',
	'disconnectCloseCode',
	'disconnectCloseReason',
	'disconnectDurationMs',
	'disconnectOccurredAt',
	'detail',
	'errorCode',
] as const;

const LOG_FIELD_LABELS: Record<string, string> = {
	timestamp: '时间',
	level: '级别',
	source: '来源',
	module: '模块',
	event: '事件',
	summary: '摘要',
	message: '消息',
	runtimeStatus: '运行时状态',
	bridgeStatus: '桥接状态',
	bridgeWebSocketUrl: '桥接地址',
	host: '监听地址',
	port: '监听端口',
	contextKey: '上下文键',
	clientId: '客户端ID',
	activeClientId: '活动客户端ID',
	leaseTerm: '租约',
	bridgeClientCount: '客户端数量',
	disconnectType: '断开类型',
	disconnectActor: '断开发起方',
	disconnectClientRole: '断开客户端角色',
	disconnectCloseCode: '断开关闭码',
	disconnectCloseReason: '断开关闭原因',
	disconnectDurationMs: '连接时长ms',
	disconnectOccurredAt: '断开时间',
	detail: '详情',
	errorCode: '错误码',
};

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
	timeZone: BEIJING_TIME_ZONE,
	hour12: false,
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
});

/**
 * 运行时日志入参结构。
 */
export interface RuntimeLogBuildInput {
	level: UnifiedLogLevel;
	event: string;
	summary: string;
	message: string;
	host: string;
	port: number;
	bridgeWebSocketUrl?: string;
	contextKey?: string;
	leaseTerm?: string;
	bridgeClientCount?: string;
	runtimeStatus?: string;
	bridgeStatus?: string;
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
}

/**
 * 统一规范文本输入，避免空值与两端空白影响日志结果。
 */
export function normalizeText(value: unknown): string {
	return String(value ?? '').trim();
}

/**
 * 生成日志唯一 ID。
 */
export function createLogId(timestamp: string, event: string, host: string, port: number): string {
	return `${Date.parse(timestamp) || Date.now()}_${event}_${host}_${port}`;
}

/**
 * 将时间文本格式化为北京时间 HH:mm:ss，用于日志展示字段。
 */
export function formatDisplayTime(timestamp: string): string {
	const normalizedTimestamp = normalizeText(timestamp);

	const parsedDate = new Date(normalizedTimestamp);
	if (!Number.isNaN(parsedDate.getTime())) {
		return BEIJING_TIME_FORMATTER.format(parsedDate);
	}

	const matchedTime = normalizedTimestamp.match(/^(\d{2}:\d{2}:\d{2})$/);
	if (matchedTime) {
		return matchedTime[1];
	}

	return normalizedTimestamp;
}

/**
 * 将空字段统一填充为“无”，避免字段在日志中消失。
 */
export function compactFields(fields: Record<string, string | undefined>): Record<string, string> {
	const compacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		const normalizedValue = normalizeText(value);
		compacted[key] = normalizedValue.length > 0 ? normalizedValue : '无';
	}
	return compacted;
}

/**
 * 获取统一日志字段定义。
 * @returns 字段顺序、字段标签与默认可见字段。
 */
export function getUnifiedLogFieldSchema(): UnifiedLogFieldSchema {
	return {
		fieldOrder: [...LOG_FIELD_ORDER],
		fieldLabels: { ...LOG_FIELD_LABELS },
		defaultVisibleFields: [...LOG_FIELD_ORDER],
	};
}

/**
 * 生成运行时结构化日志。
 * @param input 运行时日志入参。
 * @returns 统一日志记录。
 */
export function createRuntimeLogEntry(input: RuntimeLogBuildInput): UnifiedLogEntry {
	const timestamp = new Date().toISOString();
	const displayTime = formatDisplayTime(timestamp);
	const fields = compactFields({
		timestamp: displayTime,
		level: input.level,
		source: 'server',
		module: 'runtime',
		event: input.event,
		summary: input.summary,
		message: input.message,
		runtimeStatus: input.runtimeStatus,
		bridgeStatus: input.bridgeStatus,
		bridgeWebSocketUrl: input.bridgeWebSocketUrl || `ws://${input.host}:${input.port}/bridge/ws`,
		host: input.host,
		port: String(input.port),
		contextKey: input.contextKey,
		clientId: input.clientId,
		activeClientId: input.activeClientId,
		leaseTerm: input.leaseTerm,
		bridgeClientCount: input.bridgeClientCount,
		disconnectType: input.disconnectType,
		disconnectActor: input.disconnectActor,
		disconnectClientRole: input.disconnectClientRole,
		disconnectCloseCode: input.disconnectCloseCode,
		disconnectCloseReason: input.disconnectCloseReason,
		disconnectDurationMs: input.disconnectDurationMs,
		disconnectOccurredAt: input.disconnectOccurredAt,
		detail: input.detail,
		errorCode: input.errorCode,
	});

	return {
		id: createLogId(timestamp, input.event, input.host, input.port),
		timestamp,
		level: input.level,
		fields,
	};
}

/**
 * 输出统一日志文本。
 * @param logEntry 统一日志记录。
 * @returns JSON 字符串。
 */
export function formatUnifiedLogOutput(logEntry: UnifiedLogEntry): string {
	return JSON.stringify({
		id: logEntry.id,
		timestamp: logEntry.timestamp,
		level: logEntry.level,
		...logEntry.fields,
	});
}

/**
 * 判断日志是否属于连接信息类日志（客户端角色、租约、WebSocket 状态等）。
 * @param logEntry 要判断的日志记录。
 * @returns 是否为连接信息日志。
 */
export function isConnectionInfoLog(logEntry: UnifiedLogEntry): boolean {
	const fields = logEntry.fields;
	const event = String(fields.event ?? '').trim();
	if (event.startsWith('status.role.') || event.startsWith('status.connect') || event.includes('bridge.websocket')) {
		return true;
	}

	return ['clientId', 'activeClientId', 'bridgeClientCount', 'leaseTerm']
		.some((fieldKey) => String(fields[fieldKey] ?? '').trim().length > 0);
}
