/**
 * ------------------------------------------------------------------------
 * 名称：桥接协议定义
 * 说明：统一定义服务端与 EDA 连接器之间的桥接协议模型。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：协议层仅负责类型约束。
 * ------------------------------------------------------------------------
 */

import type { UnifiedLogEntry } from '../../logging/server-log';

export type BridgeRole = 'active' | 'standby';

export interface BridgeDebugSwitch {
	enableSystemLog: boolean;
	enableConnectionList: boolean;
}

export interface BridgeClientHelloMessage {
	type: 'bridge/hello';
	clientId: string;
	connectorVersion?: string;
}

export interface BridgeClientHeartbeatMessage {
	type: 'bridge/heartbeat';
	clientId: string;
	sentAt: number;
}

export interface BridgeClientResultMessage {
	type: 'bridge/result';
	clientId: string;
	requestId: string;
	leaseTerm: number;
	result?: unknown;
	error?: unknown;
}

export interface BridgeClientLogMessage {
	type: 'bridge/log';
	clientId: string;
	log: UnifiedLogEntry;
}

export interface BridgeServerWelcomeMessage {
	type: 'bridge/welcome';
	clientId: string;
	connectedAt: string;
}

export interface BridgeServerRoleMessage {
	type: 'bridge/role';
	clientId: string;
	role: BridgeRole;
	leaseTerm: number;
	activeClientId: string;
	reason: string;
}

export interface BridgeServerDebugSwitchMessage {
	type: 'bridge/debug-switch';
	clientId: string;
	debugSwitch: BridgeDebugSwitch;
}

export interface BridgeServerHeartbeatAckMessage {
	type: 'bridge/heartbeat-ack';
	clientId: string;
	sentAt: number;
	receivedAt: string;
}

export interface BridgeServerTaskMessage {
	type: 'bridge/task';
	requestId: string;
	path: string;
	payload: unknown;
	createdAt: number;
	leaseTerm: number;
}

export interface BridgeServerErrorMessage {
	type: 'bridge/error';
	message: string;
	requestId?: string;
}

export type BridgeClientMessage = BridgeClientHelloMessage | BridgeClientHeartbeatMessage | BridgeClientResultMessage | BridgeClientLogMessage;

export type BridgeServerMessage = BridgeServerWelcomeMessage | BridgeServerRoleMessage | BridgeServerDebugSwitchMessage | BridgeServerHeartbeatAckMessage | BridgeServerTaskMessage | BridgeServerErrorMessage;

export interface BridgeQueueRequest {
	requestId: string;
	path: string;
	payload: unknown;
	createdAt: number;
}
