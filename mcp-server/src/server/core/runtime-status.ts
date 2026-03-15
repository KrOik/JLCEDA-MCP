/**
 * ------------------------------------------------------------------------
 * 名称：运行时状态文件
 * 说明：负责生成 stdio 运行时状态文件路径，并提供状态快照的读写能力。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-10
 * 备注：供扩展宿主与独立运行时进程共享真实状态。
 * ------------------------------------------------------------------------
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BridgeDisconnectSnapshot, RuntimeStatusSnapshot, ServerConfig } from './status';
import { isUnifiedLogEntry } from '../../status-log';

// stdio 运行时状态文件命令行参数名。
export const STATUS_FILE_FLAG = '--status-file';
// 运行时状态文件名前缀。
const RUNTIME_STATUS_FILE_PREFIX = 'jlceda-mcp-runtime-status';
// 运行时状态心跳有效期，超过后视为旧状态。
export const RUNTIME_STATUS_STALE_TTL_MS = 4000;

// 将路径片段压缩为安全文件名。
function sanitizeFileSegment(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';
}

// 校验断开事件快照结构是否完整。
function isBridgeDisconnectSnapshot(value: unknown): value is BridgeDisconnectSnapshot {
  if (value === null) {
    return true;
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<BridgeDisconnectSnapshot>;
  return typeof snapshot.eventId === 'string'
    && snapshot.eventId.trim().length > 0
    && typeof snapshot.clientId === 'string'
    && typeof snapshot.clientRole === 'string'
    && typeof snapshot.disconnectType === 'string'
    && typeof snapshot.disconnectActor === 'string'
    && typeof snapshot.closeCode === 'string'
    && typeof snapshot.closeReason === 'string'
    && typeof snapshot.detail === 'string'
    && Number.isInteger(snapshot.leaseTerm)
    && Number.isInteger(snapshot.connectedDurationMs)
    && Number.isInteger(snapshot.remainingClientCount)
    && typeof snapshot.occurredAt === 'string'
    && snapshot.occurredAt.trim().length > 0;
}

// 校验运行时状态快照结构是否完整。
function isRuntimeStatusSnapshot(value: unknown): value is RuntimeStatusSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<RuntimeStatusSnapshot>;
  const runtimeStatus = String(snapshot.runtimeStatus ?? '').trim();
  const hasValidConnectorLogs = snapshot.connectorLogs === undefined
    || (Array.isArray(snapshot.connectorLogs) && snapshot.connectorLogs.every((entry) => isUnifiedLogEntry(entry)));
  return typeof snapshot.host === 'string'
    && snapshot.host.trim().length > 0
    && Number.isInteger(snapshot.port)
    && Number(snapshot.port) > 0
    && ['starting', 'running', 'stopped', 'error'].includes(runtimeStatus)
    && typeof snapshot.runtimeMessage === 'string'
    && Array.isArray(snapshot.bridgeClientIds)
    && Number.isInteger(snapshot.bridgeClientCount)
    && Number(snapshot.bridgeClientCount) >= 0
    && hasValidConnectorLogs
    && typeof snapshot.lastErrorMessage === 'string'
    && isBridgeDisconnectSnapshot(snapshot.lastDisconnect ?? null)
    && typeof snapshot.updatedAt === 'string'
    && snapshot.updatedAt.trim().length > 0;
}

/**
 * 生成当前扩展宿主专属的运行时状态文件路径。
 * @param storageDirectoryPath 扩展全局存储目录绝对路径。
 * @param config 当前桥接监听配置。
 * @param sessionId 当前编辑器会话唯一标识。
 * @returns 运行时状态文件绝对路径。
 */
export function getRuntimeStatusFilePath(storageDirectoryPath: string, config: ServerConfig, sessionId: string): string {
  const fileName = [
    RUNTIME_STATUS_FILE_PREFIX,
    sanitizeFileSegment(sessionId),
    sanitizeFileSegment(config.host),
    sanitizeFileSegment(String(config.port))
  ].join('-');
  return path.join(storageDirectoryPath, `${fileName}.json`);
}

/**
 * 写入运行时状态快照。
 * @param statusFilePath 状态文件绝对路径。
 * @param snapshot 待写入的状态快照。
 */
export function writeRuntimeStatusSnapshot(statusFilePath: string, snapshot: RuntimeStatusSnapshot): void {
  fs.mkdirSync(path.dirname(statusFilePath), { recursive: true });
  fs.writeFileSync(statusFilePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

/**
 * 读取运行时状态快照。
 * @param statusFilePath 状态文件绝对路径。
 * @returns 状态快照，不存在或格式非法时返回 undefined。
 */
export function readRuntimeStatusSnapshot(statusFilePath: string): RuntimeStatusSnapshot | undefined {
  if (!fs.existsSync(statusFilePath)) {
    return undefined;
  }

  try {
    const rawText = fs.readFileSync(statusFilePath, 'utf8');
    const parsed = JSON.parse(rawText) as unknown;
    if (!isRuntimeStatusSnapshot(parsed)) {
      return undefined;
    }

    return parsed;
  }
  catch {
    return undefined;
  }
}

/**
 * 判断运行时状态是否已经过期。
 * @param snapshot 运行时状态快照。
 * @returns 是否超过心跳有效期。
 */
export function isRuntimeStatusSnapshotStale(snapshot: RuntimeStatusSnapshot): boolean {
  const updatedAt = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  return Date.now() - updatedAt > RUNTIME_STATUS_STALE_TTL_MS;
}