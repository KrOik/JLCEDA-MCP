/**
 * ------------------------------------------------------------------------
 * 名称：服务端状态管理器
 * 说明：统一维护服务端状态文案与状态快照转换逻辑。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-20
 * 备注：只处理状态数据，不处理日志输出与网络传输。
 * ------------------------------------------------------------------------
 */

import type { SidebarConnectedClientEntry } from '../sidebar/sidebar-protocol';
import type { RuntimeStatusSnapshot, ServerConfig, ServerStatus } from './status';

/**
 * 服务端状态管理器。
 */
export class ServerStateManager {
	public static readonly text = {
		runtimeReady: '已就绪。',
		runtimeRunning: '运行中...',
		runtimeStarting: 'stdio 运行时正在启动。',
		runtimeStopped: 'stdio 会话已结束，等待宿主再次拉起本地运行时。',
		runtimeError: 'stdio 运行时异常退出。',
		bridgeDisconnectNotice: 'MCP 服务端已断开，正在尝试重新连接。',
		serverClosingReason: '服务端正在关闭',
		bridgeWaiting: '桥接客户端未连接。',
		bridgeConnected: '当前活动页面已连接。',
		bridgeUnavailable: '桥接监听不可用。',
		sidebarRefreshError: '侧边栏状态更新失败。',
		sidebarBridgeReadError: '无法读取当前桥接状态。',
		summaryErrorFallback: '连接异常',
		summaryConnected: '桥接在线',
		summaryStarting: '运行时启动中',
		summaryStopped: 'stdio 会话结束',
		summaryWaiting: '等待桥接',
		summaryUpdated: '状态已更新',
	} as const;

	/**
	 * 创建空闲状态。
	 * @param config 当前配置。
	 * @returns 空闲状态快照。
	 */
	public createIdleState(config: ServerConfig): ServerStatus {
		return {
			host: config.host,
			port: config.port,
			runtimeStatus: 'idle',
			runtimeMessage: ServerStateManager.text.runtimeReady,
			bridgeStatus: 'waiting',
			bridgeMessage: ServerStateManager.text.bridgeWaiting,
			lastDisconnect: null,
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * 创建侧边栏刷新失败状态。
	 * @param config 当前配置。
	 * @returns 异常状态快照。
	 */
	public createSidebarRefreshErrorState(config: ServerConfig): ServerStatus {
		return {
			host: config.host,
			port: config.port,
			runtimeStatus: 'error',
			runtimeMessage: ServerStateManager.text.sidebarRefreshError,
			bridgeStatus: 'error',
			bridgeMessage: ServerStateManager.text.sidebarBridgeReadError,
			lastDisconnect: null,
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * 将运行时快照中的客户端列表转为侧边栏结构。
	 * @param clientIds 原始客户端列表。
	 * @returns 规范化后的连接列表。
	 */
	public createSidebarClients(clientIds: string[]): SidebarConnectedClientEntry[] {
		const normalizedClientIds = clientIds
			.map((clientId) => String(clientId ?? '').trim())
			.filter((clientId, index, allClientIds) => clientId.length > 0 && allClientIds.indexOf(clientId) === index);

		return normalizedClientIds.map((clientId, index) => ({
			clientId,
			role: index === 0 ? 'active' : 'standby',
		}));
	}

	/**
	 * 从运行时快照解析桥接状态文案。
	 * @param runtimeStatus 运行时状态。
	 * @param connectedClientCount 已连接客户端数量。
	 * @returns 桥接状态与桥接文案。
	 */
	public resolveBridgeStatus(
		runtimeStatus: RuntimeStatusSnapshot['runtimeStatus'],
		connectedClientCount: number,
	): Pick<ServerStatus, 'bridgeStatus' | 'bridgeMessage'> {
		if (runtimeStatus === 'error') {
			return {
				bridgeStatus: 'error',
				bridgeMessage: ServerStateManager.text.bridgeUnavailable,
			};
		}

		if (connectedClientCount > 0) {
			return {
				bridgeStatus: 'connected',
				bridgeMessage: ServerStateManager.text.bridgeConnected,
			};
		}

		return {
			bridgeStatus: 'waiting',
			bridgeMessage: ServerStateManager.text.bridgeWaiting,
		};
	}

	/**
	 * 当状态快照过期时生成停止态。
	 * @param config 当前配置。
	 * @param snapshot 运行时快照。
	 * @returns 过期后的展示状态。
	 */
	public createStaleRuntimeState(config: ServerConfig, snapshot: RuntimeStatusSnapshot): ServerStatus {
		return {
			host: config.host,
			port: config.port,
			runtimeStatus: 'stopped',
			runtimeMessage: ServerStateManager.text.runtimeReady,
			bridgeStatus: 'waiting',
			bridgeMessage: ServerStateManager.text.bridgeWaiting,
			lastDisconnect: snapshot.lastDisconnect,
			updatedAt: snapshot.updatedAt,
		};
	}
}
