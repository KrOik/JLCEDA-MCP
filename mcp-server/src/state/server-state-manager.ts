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
		// 运行时阶段文案：用于 stdio 生命周期状态展示。
		runtime: {
			ready: '已就绪。',
			running: '运行中...',
			starting: 'stdio 运行时正在启动。',
			stopped: 'stdio 会话已结束，等待宿主再次拉起本地运行时。',
			error: 'stdio 运行时异常退出。',
		},
		// 桥接状态文案：用于桥接连接状态与关闭通知。
		bridge: {
			disconnectNotice: 'MCP 服务端已断开，正在尝试重新连接。',
			serverClosingReason: '服务端正在关闭',
			waiting: '桥接客户端未连接。',
			connected: '当前活动页面已连接。',
			unavailable: '桥接监听不可用。',
		},
		// 侧边栏状态文案：用于侧边栏读取与刷新失败提示。
		sidebar: {
			refreshError: '侧边栏状态更新失败。',
			bridgeReadError: '无法读取当前桥接状态。',
		},
		// 状态摘要文案：用于状态日志与简要描述。
		summary: {
			errorFallback: '连接异常',
			connected: '桥接在线',
			starting: '运行时启动中',
			stopped: 'stdio 会话结束',
			waiting: '等待桥接',
			updated: '状态已更新',
		},
		// 桥接仲裁中心文案：按等待/协议/连接/角色/版本分类，便于维护与检索。
		broker: {
			// 等待与超时相关文案：用于请求排队、结果回包与连接就绪提示。
			wait: {
				peerNotReadyError: 'EDA 桥接客户端未就绪。',
				waitActivePeerTimeoutReason: '等待活动客户端超时',
				waitResultTimeoutReason: '等待桥接回包超时',
				waitActivePeerTimeoutMessagePrefix: '桥接请求超时（等待活动客户端）',
				waitResultTimeoutMessagePrefix: '桥接请求超时（等待桥接回包）',
				buildBridgeReadyTimeoutMessage: (timeoutMs: number) => `EDA 连接器未连接，等待 ${timeoutMs} ms 超时。请在嘉立创 EDA 专业版中打开任意工程后重试。`,
			},
			// 协议校验相关文案：用于消息结构校验与类型分派错误。
			protocol: {
				invalidMessageRoot: '桥接消息格式非法，根节点必须是对象。',
				missingMessageType: '桥接消息缺少 type 字段。',
				unknownClientMessageTypePrefix: '收到未知客户端消息类型',
				unsupportedBridgeMessageType: '不支持的桥接消息类型。',
				invalidClientLogEntry: '客户端日志结构非法。',
			},
			// 连接生命周期文案：用于连接建立、断开与发送失败等场景。
			connection: {
				emptyFallback: '无',
				socketNotOpen: '桥接连接未打开。',
				heartbeatTimeoutDetail: '桥接客户端心跳超时。',
				heartbeatTimeoutReason: '心跳超时',
				missingClientId: '桥接客户端缺少 clientId。',
				clientConnectionClosed: '桥接客户端连接已关闭。',
				clientConnectionInterrupted: '桥接客户端连接异常中断。',
				taskSendFailure: '桥接任务发送失败，活动客户端已下线。',
			},
			// 角色裁决文案：用于选主、角色确认和待命切换。
			role: {
				firstClientBecameActive: '首个连接已成为活动客户端。',
				activeRoleConfirmed: '活动客户端状态已确认。',
				enterStandbyRole: '当前客户端进入待命状态。',
				autoTakeoverAfterActiveOffline: '活动客户端离线，已从待命客户端自动接管。',
			},
			// 版本兼容文案：用于缺失版本信息时的兜底展示。
			version: {
				legacyClientWithoutVersion: '旧版客户端（未上报版本）',
			},
		},
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
			runtimeMessage: ServerStateManager.text.runtime.ready,
			bridgeStatus: 'waiting',
			bridgeMessage: ServerStateManager.text.bridge.waiting,
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
			runtimeMessage: ServerStateManager.text.sidebar.refreshError,
			bridgeStatus: 'error',
			bridgeMessage: ServerStateManager.text.sidebar.bridgeReadError,
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
				bridgeMessage: ServerStateManager.text.bridge.unavailable,
			};
		}

		if (connectedClientCount > 0) {
			return {
				bridgeStatus: 'connected',
				bridgeMessage: ServerStateManager.text.bridge.connected,
			};
		}

		return {
			bridgeStatus: 'waiting',
			bridgeMessage: ServerStateManager.text.bridge.waiting,
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
			runtimeMessage: ServerStateManager.text.runtime.ready,
			bridgeStatus: 'waiting',
			bridgeMessage: ServerStateManager.text.bridge.waiting,
			lastDisconnect: snapshot.lastDisconnect,
			updatedAt: snapshot.updatedAt,
		};
	}
}
