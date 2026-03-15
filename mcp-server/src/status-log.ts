/**
 * ------------------------------------------------------------------------
 * 名称：服务端状态与日志模型
 * 说明：集中定义服务端状态文案、统一日志字段与日志构造逻辑。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：本文件仅处理数据，不调用 VS Code 或网络 API。
 * 
 * 错误码说明：
 *   无：当前日志无错误。
 *   bridge_runtime_error：桥接运行时启动或监听异常。
 *   runtime_or_bridge_error：运行时或桥接状态异常（通用错误）。
 *   ws_disconnect_client_close：客户端主动关闭连接。
 *   ws_disconnect_server_shutdown：服务端关闭导致连接断开。
 *   ws_disconnect_heartbeat_timeout：心跳超时导致连接断开。
 *   ws_disconnect_socket_error：WebSocket 连接异常导致断开。
 *   ws_disconnect_send_failure：发送任务失败后触发断开。
 * 
 * 断开关闭码说明：
 *   1000：正常关闭。
 *   1001：服务端关闭或页面离开。
 *   1006：异常中断（常见于网络断开）。
 *   无：未收到标准 close 帧（如心跳超时或发送失败）。
 * ------------------------------------------------------------------------
 */

import type { BridgeDisconnectSnapshot, ServerStatus } from './server/core/status';

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
 * 服务端状态文案常量。
 */
export const SERVER_STATUS_TEXT = {
  runtimeReady: '已就绪。', // 运行时空闲待命提示。
  runtimeRunning: '运行中...', // 运行时正常工作提示。
  runtimeStarting: 'stdio 运行时正在启动。', // 运行时启动过程提示。
  runtimeStopped: 'stdio 会话已结束，等待宿主再次拉起本地运行时。', // 运行时停止提示。
  runtimeError: 'stdio 运行时异常退出。', // 运行时异常提示。
  bridgeDisconnectNotice: 'MCP 服务端已断开，正在尝试重新连接。', // 桥接断开重连提示。
  serverClosingReason: '服务端正在关闭', // 服务端主动关闭原因。
  bridgeWaiting: '桥接客户端未连接。', // 桥接未连接提示。
  bridgeConnected: '当前活动页面已连接。', // 桥接已连接提示。
  bridgeUnavailable: '桥接监听不可用。', // 桥接不可用提示。
  sidebarRefreshError: '侧边栏状态更新失败。', // 侧边栏刷新失败文案。
  sidebarBridgeReadError: '无法读取当前桥接状态。', // 侧边栏读取桥接状态失败文案。
  summaryErrorFallback: '连接异常', // 摘要兜底异常文案。
  summaryConnected: '桥接在线', // 摘要在线文案。
  summaryStarting: '运行时启动中', // 摘要启动中文案。
  summaryStopped: 'stdio 会话结束', // 摘要停止文案。
  summaryWaiting: '等待桥接', // 摘要等待文案。
  summaryUpdated: '状态已更新', // 摘要更新完成文案。
} as const;

// 统一日志字段顺序常量。
const LOG_FIELD_ORDER = [
  'timestamp', // 时间。
  'level', // 级别。
  'source', // 来源。
  'module', // 模块。
  'event', // 事件。
  'summary', // 摘要。
  'message', // 消息。
  'runtimeStatus', // 运行时状态。
  'bridgeStatus', // 桥接状态。
  'bridgeWebSocketUrl', // 桥接地址。
  'host', // 监听地址。
  'port', // 监听端口。
  'contextKey', // 上下文键。
  'clientId', // 客户端 ID。
  'activeClientId', // 活动客户端 ID。
  'leaseTerm', // 租约。
  'bridgeClientCount', // 客户端数量。
  'disconnectType', // 断开类型。
  'disconnectActor', // 断开发起方。
  'disconnectClientRole', // 断开客户端角色。
  'disconnectCloseCode', // 断开关闭码。
  'disconnectCloseReason', // 断开关闭原因。
  'disconnectDurationMs', // 连接持续时长。
  'disconnectOccurredAt', // 断开时间。
  'detail', // 详情。
  'errorCode', // 错误码。
] as const;

// 统一日志字段中文标签常量。
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

// 状态摘要最大长度常量。
const STATUS_LOG_SUMMARY_MAX_LENGTH = 40;
// 日志显示使用的北京时间时区常量。
const BEIJING_TIME_ZONE = 'Asia/Shanghai';
// 日志显示时间格式化器常量。
const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// 统一规范文本输入，避免空值与两端空白影响日志结果。
function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

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

// 断开事件在快照中持续可见的时间窗口，确保侧边栏至少有一个完整的轮询周期能捕获。
const DISCONNECT_SNAPSHOT_VISIBLE_WINDOW_MS = 5000;

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
    return truncateSummary(runtimeMessage.length > 0 ? runtimeMessage : SERVER_STATUS_TEXT.summaryErrorFallback);
  }

  if (state.bridgeStatus === 'connected') {
    return SERVER_STATUS_TEXT.summaryConnected;
  }

  if (state.runtimeStatus === 'starting') {
    return SERVER_STATUS_TEXT.summaryStarting;
  }

  if (state.runtimeStatus === 'stopped') {
    return SERVER_STATUS_TEXT.summaryStopped;
  }

  if (state.bridgeStatus === 'waiting') {
    return SERVER_STATUS_TEXT.summaryWaiting;
  }

  return truncateSummary(runtimeMessage.length > 0 ? runtimeMessage : SERVER_STATUS_TEXT.summaryUpdated);
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

// 生成日志唯一 ID。
function createLogId(timestamp: string, event: string, host: string, port: number): string {
  return `${Date.parse(timestamp) || Date.now()}_${event}_${host}_${port}`;
}

// 将时间文本格式化为北京时间 HH:mm:ss，用于日志展示字段。
function formatDisplayTime(timestamp: string): string {
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

// 将空字段统一填充为“无”，避免字段在日志中消失。
function compactFields(fields: Record<string, string | undefined>): Record<string, string> {
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
 * 生成状态签名，用于去重连续相同状态日志。
 * @param state 当前服务端状态。
 * @param bridgeClientCount 当前桥接客户端数量。
 * @returns 状态签名字符串。
 */
export function createServerStatusLogSignature(state: ServerStatus, bridgeClientCount: number): string {
  const disconnectSnapshot = getCurrentDisconnectSnapshot(state);
  return [
    state.runtimeStatus,
    state.runtimeMessage,
    state.bridgeStatus,
    state.bridgeMessage,
    String(bridgeClientCount),
    disconnectSnapshot ? disconnectSnapshot.eventId : '',
  ].join('\n');
}

/**
 * 生成侧边栏状态日志记录。
 * @param state 当前服务端状态。
 * @param bridgeClientCount 当前桥接客户端数量。
 * @returns 统一日志记录。
 */
export function createServerStatusLogEntry(state: ServerStatus, bridgeClientCount: number): UnifiedLogEntry {
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
    : (normalizeText(state.runtimeMessage) || normalizeText(state.bridgeMessage) || SERVER_STATUS_TEXT.summaryUpdated);
  const clientId = disconnectSnapshot ? normalizeText(disconnectSnapshot.clientId) : '';
  const activeClientId = '';
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
    bridgeClientCount: String(bridgeClientCount),
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

/**
 * 运行时日志入参结构。
 */
interface RuntimeLogBuildInput {
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
 * 校验统一日志结构。
 * @param value 待校验对象。
 * @returns 是否为合法的 UnifiedLogEntry。
 */
export function isUnifiedLogEntry(value: unknown): value is UnifiedLogEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const logEntry = value as Record<string, unknown>;
  if (typeof logEntry.id !== 'string' || logEntry.id.trim().length === 0) {
    return false;
  }

  if (typeof logEntry.timestamp !== 'string' || logEntry.timestamp.trim().length === 0) {
    return false;
  }

  if (!['info', 'success', 'warning', 'error'].includes(String(logEntry.level ?? ''))) {
    return false;
  }

  if (!logEntry.fields || typeof logEntry.fields !== 'object' || Array.isArray(logEntry.fields)) {
    return false;
  }

  const fields = logEntry.fields as Record<string, unknown>;
  return Object.values(fields).every((fieldValue) => typeof fieldValue === 'string');
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
