/**
 * ------------------------------------------------------------------------
 * 名称：桥接协议定义
 * 说明：集中定义桥接客户端与服务端通信协议及活动角色模型。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：协议层仅描述消息结构，不承载执行逻辑。
 * ------------------------------------------------------------------------
 */

import type { UnifiedLogEntry } from '../status-log';

// 桥接角色，仅允许活动与待命两种。
export type BridgeRole = 'active' | 'standby';

// 调试开关配置。
export interface BridgeDebugSwitch {
	enableSystemLog: boolean;
	enableConnectionList: boolean;
}

// 客户端上报握手消息。
export interface BridgeClientHelloMessage {
	type: 'bridge/hello';
	clientId: string;
}

// 客户端上报心跳消息。
export interface BridgeClientHeartbeatMessage {
	type: 'bridge/heartbeat';
	clientId: string;
	sentAt: number;
}

// 客户端回传任务执行结果。
export interface BridgeClientResultMessage {
	type: 'bridge/result';
	clientId: string;
	requestId: string;
	leaseTerm: number;
	result?: unknown;
	error?: {
		message: string;
		stack?: string;
	};
}

// 客户端上报日志消息。
export interface BridgeClientLogMessage {
	type: 'bridge/log';
	clientId: string;
	log: UnifiedLogEntry;
}

// 服务端返回握手确认消息。
export interface BridgeServerWelcomeMessage {
	type: 'bridge/welcome';
	clientId: string;
	connectedAt: string;
}

// 服务端下发角色更新消息。
export interface BridgeServerRoleMessage {
	type: 'bridge/role';
	clientId: string;
	role: BridgeRole;
	leaseTerm: number;
	activeClientId: string;
	reason: string;
}

// 服务端下发调试开关消息。
export interface BridgeServerDebugSwitchMessage {
	type: 'bridge/debug-switch';
	clientId: string;
	debugSwitch: BridgeDebugSwitch;
}

// 服务端返回心跳确认消息。
export interface BridgeServerHeartbeatAckMessage {
	type: 'bridge/heartbeat-ack';
	clientId: string;
	sentAt: number;
	receivedAt: string;
}

// 服务端下发桥接任务消息。
export interface BridgeServerTaskMessage {
	type: 'bridge/task';
	requestId: string;
	path: string;
	payload: unknown;
	createdAt: number;
	leaseTerm: number;
}

// 服务端下发错误消息。
export interface BridgeServerErrorMessage {
	type: 'bridge/error';
	message: string;
	requestId?: string;
}

export type BridgeClientMessage = BridgeClientHelloMessage | BridgeClientHeartbeatMessage | BridgeClientResultMessage | BridgeClientLogMessage;

export type BridgeServerMessage = BridgeServerWelcomeMessage | BridgeServerRoleMessage | BridgeServerDebugSwitchMessage | BridgeServerHeartbeatAckMessage | BridgeServerTaskMessage | BridgeServerErrorMessage;

// 任务载荷定义。
export interface BridgeQueueTask {
	requestId: string;
	path: string;
	payload: unknown;
	createdAt: number;
	leaseTerm: number;
}
