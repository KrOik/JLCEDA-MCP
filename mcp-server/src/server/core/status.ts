/**
 * ------------------------------------------------------------------------
 * 名称：服务状态类型定义
 * 说明：集中定义服务运行状态与配置结构。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：供配置、进程与侧边栏模块共享。
 * ------------------------------------------------------------------------
 */

import type { UnifiedLogEntry } from '../../status-log';

/**
 * 服务运行状态枚举。
 */
export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

/**
 * 桥接客户端接入状态枚举。
 */
export type BridgeStatus = 'waiting' | 'connected' | 'error';

/**
 * WebSocket 断开事件快照。
 */
export interface BridgeDisconnectSnapshot {
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

/**
 * stdio 运行时写入磁盘的状态快照。
 */
export interface RuntimeStatusSnapshot {
  host: string;
  port: number;
  runtimeStatus: Exclude<RuntimeStatus, 'idle'>;
  runtimeMessage: string;
  bridgeClientCount: number;
  bridgeClientIds: string[];
  connectorLogs?: UnifiedLogEntry[];
  lastErrorMessage: string;
  lastDisconnect: BridgeDisconnectSnapshot | null;
  updatedAt: string;
}

/**
 * 当前配置与接入状态快照。
 */
export interface ServerStatus {
  host: string;
  port: number;
  runtimeStatus: RuntimeStatus;
  runtimeMessage: string;
  bridgeStatus: BridgeStatus;
  bridgeMessage: string;
  lastDisconnect: BridgeDisconnectSnapshot | null;
  updatedAt: string;
}

/**
 * 桥接 WebSocket 监听配置。
 */
export interface ServerConfig {
  host: string;
  port: number;
}
