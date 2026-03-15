/**
 * ------------------------------------------------------------------------
 * 名称：桥接状态存储
 * 说明：管理页面状态快照、活动状态快照与上下文作用域键。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：为页面 UI 和桥接运行时提供共享状态。
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord } from '../utils';

// 固定连接状态存储键，与上下文无关，设置页直接轮询此键。
const MCP_CONNECTION_STATUS_KEY = 'jlc_mcp_connection_status';

export type ConnectionStatusType = 'connecting' | 'connected' | 'error';

/**
 * 连接状态快照：仅包含设置页两个胶囊所需的展示信息，由服务端数据驱动。
 */
export interface ConnectionStatusSnapshot {
	bridgeType: ConnectionStatusType;
	bridgeText: string;
	websocketType: ConnectionStatusType;
	websocketText: string;
	updatedAt: string;
}

/**
 * 判断值是否为合法连接状态快照。
 * @param value 待判断值。
 * @returns 是否合法。
 */
export function isConnectionStatusSnapshot(value: unknown): value is ConnectionStatusSnapshot {
	if (!isPlainObjectRecord(value)) {
		return false;
	}
	const validTypes = new Set(['connecting', 'connected', 'error']);
	return validTypes.has(String(value.bridgeType ?? '').trim())
		&& validTypes.has(String(value.websocketType ?? '').trim())
		&& typeof value.bridgeText === 'string'
		&& typeof value.websocketText === 'string'
		&& typeof value.updatedAt === 'string';
}

/**
 * 写入连接状态快照到固定存储键，火忘即发。
 * @param snapshot 状态快照。
 */
export function saveConnectionStatus(snapshot: ConnectionStatusSnapshot): void {
	void eda.sys_Storage.setExtensionUserConfig(MCP_CONNECTION_STATUS_KEY, snapshot);
}

/**
 * 读取连接状态快照。
 * @returns 状态快照，不存在或格式非法时返回 undefined。
 */
export function readConnectionStatus(): ConnectionStatusSnapshot | undefined {
	try {
		const raw = eda.sys_Storage.getExtensionUserConfig(MCP_CONNECTION_STATUS_KEY);
		return isConnectionStatusSnapshot(raw) ? raw : undefined;
	}
	catch {
		return undefined;
	}
}
