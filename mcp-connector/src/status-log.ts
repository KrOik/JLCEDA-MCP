/**
 * ------------------------------------------------------------------------
 * 名称：桥接状态与日志模型
 * 说明：集中定义桥接端状态文案、统一日志字段与日志构造逻辑。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：本文件仅处理数据，不调用 EDA API。
 * ------------------------------------------------------------------------
 */

export type UnifiedLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface UnifiedLogFieldSchema {
	fieldOrder: string[];
	fieldLabels: Record<string, string>;
	defaultVisibleFields: string[];
}

export interface UnifiedLogEntry {
	id: string;
	timestamp: string;
	level: UnifiedLogLevel;
	fields: Record<string, string>;
}

type ConnectorLogListener = (logEntry: UnifiedLogEntry) => void;

export const CONNECTOR_STATUS_TEXT = {
	connectingWaiting: '连接器正在等待 VS Code 侧服务就绪...',
	connectingService: '正在连接桥接服务',
	connected: '已连接',
	disconnected: '未连接',
	websocketConnecting: '连接中',
	connectFailed: '连接失败，stdio 未启动。',
	connectFailedRetryDetail: '连接失败，系统将自动重试',
	standby: '当前页面待命中',
	statusInitFailed: '状态初始化失败',
	configInvalid: '配置无效',
	configSaved: '配置已保存。',
	currentClientPrefix: '当前客户端：',
	activeClientPrefix: '当前活动客户端：',
	standbyDetailFallback: '其他页面正在持有桥接连接。',
	roleReasonSummary: '桥接角色变更',
	statusSaveFailedSummary: '桥接状态保存失败',
	statusPublishFailedSummary: '桥接状态广播失败',
	activePublishFailedSummary: '活动状态广播失败',
	taskFailedSummary: '桥接任务执行失败',
	contextSyncFailedSummary: '桥接上下文同步失败',
	serverErrorSummary: '桥接服务端返回错误',
	settingsInitFailedSummary: '状态初始化失败',
	settingsConfigInvalidSummary: '页面配置无效',
	settingsPublishFailedSummary: '配置更新消息发送失败',
	contextNotInitialized: '桥接上下文尚未初始化。',
	taskRejectedStandby: '当前客户端处于待命状态，拒绝执行任务。',
	taskLeaseExpired: '任务租约已过期。',
	taskPathUnsupportedPrefix: '不支持的任务路径：',
} as const;

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
	detail: '详情',
	errorCode: '错误码',
};

const CONNECTOR_LOG_LIMIT = 200;
const connectorLogs: UnifiedLogEntry[] = [];
let connectorLogListener: ConnectorLogListener | undefined;

function normalizeText(value: unknown): string {
	return String(value ?? '').trim();
}

function formatBeijingTimeOnly(date: Date): string {
	try {
		return new Intl.DateTimeFormat('zh-CN', {
			timeZone: 'Asia/Shanghai',
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		}).format(date);
	}
	catch {
		const utcMillis = date.getTime();
		const beijingDate = new Date(utcMillis + (8 * 60 * 60 * 1000));
		const hh = String(beijingDate.getUTCHours()).padStart(2, '0');
		const mm = String(beijingDate.getUTCMinutes()).padStart(2, '0');
		const ss = String(beijingDate.getUTCSeconds()).padStart(2, '0');
		return `${hh}:${mm}:${ss}`;
	}
}

function createLogId(timestamp: string, event: string, module: string): string {
	return `${Date.parse(timestamp) || Date.now()}_${module}_${event}`;
}

function compactFields(fields: Record<string, string | undefined>): Record<string, string> {
	const compacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		const normalizedValue = normalizeText(value);
		if (normalizedValue.length === 0) {
			continue;
		}
		compacted[key] = normalizedValue;
	}
	return compacted;
}

export function getUnifiedLogFieldSchema(): UnifiedLogFieldSchema {
	return {
		fieldOrder: [...LOG_FIELD_ORDER],
		fieldLabels: { ...LOG_FIELD_LABELS },
		defaultVisibleFields: [...LOG_FIELD_ORDER],
	};
}

export interface ConnectorLogBuildInput {
	level: UnifiedLogLevel;
	module: string;
	event: string;
	summary: string;
	message: string;
	runtimeStatus?: string;
	bridgeStatus?: string;
	bridgeWebSocketUrl?: string;
	host?: string;
	port?: string;
	contextKey?: string;
	clientId?: string;
	activeClientId?: string;
	leaseTerm?: string;
	bridgeClientCount?: string;
	detail?: string;
	errorCode?: string;
}

export function createConnectorLogEntry(input: ConnectorLogBuildInput): UnifiedLogEntry {
	const now = new Date();
	const timestamp = now.toISOString();
	const displayTime = formatBeijingTimeOnly(now);
	const fields = compactFields({
		timestamp: displayTime,
		level: input.level,
		source: 'connector',
		module: input.module,
		event: input.event,
		summary: input.summary,
		message: input.message,
		runtimeStatus: input.runtimeStatus,
		bridgeStatus: input.bridgeStatus,
		bridgeWebSocketUrl: input.bridgeWebSocketUrl,
		host: input.host,
		port: input.port,
		contextKey: input.contextKey,
		clientId: input.clientId,
		activeClientId: input.activeClientId,
		leaseTerm: input.leaseTerm,
		bridgeClientCount: input.bridgeClientCount,
		detail: input.detail,
		errorCode: input.errorCode,
	});

	return {
		id: createLogId(timestamp, input.event, input.module),
		timestamp,
		level: input.level,
		fields,
	};
}

export function appendConnectorLog(logEntry: UnifiedLogEntry): UnifiedLogEntry {
	connectorLogs.push(logEntry);
	if (connectorLogs.length > CONNECTOR_LOG_LIMIT) {
		connectorLogs.splice(0, connectorLogs.length - CONNECTOR_LOG_LIMIT);
	}

	if (connectorLogListener) {
		try {
			connectorLogListener(logEntry);
		}
		catch {
			// 日志监听异常不影响本地日志写入。
		}
	}

	return logEntry;
}

export function setConnectorLogListener(listener: ConnectorLogListener | undefined): void {
	connectorLogListener = listener;
}

export function isUnifiedLogEntry(value: unknown): value is UnifiedLogEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const recordValue = value as Record<string, unknown>;
	if (typeof recordValue.id !== 'string' || normalizeText(recordValue.id).length === 0) {
		return false;
	}
	if (typeof recordValue.timestamp !== 'string' || normalizeText(recordValue.timestamp).length === 0) {
		return false;
	}
	if (recordValue.level !== 'info' && recordValue.level !== 'success' && recordValue.level !== 'warning' && recordValue.level !== 'error') {
		return false;
	}
	if (!recordValue.fields || typeof recordValue.fields !== 'object' || Array.isArray(recordValue.fields)) {
		return false;
	}

	return true;
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
		.some(fieldKey => String(fields[fieldKey] ?? '').trim().length > 0);
}

export function formatUnifiedLogOutput(logEntry: UnifiedLogEntry): string {
	return JSON.stringify({
		id: logEntry.id,
		timestamp: logEntry.timestamp,
		level: logEntry.level,
		...logEntry.fields,
	});
}
