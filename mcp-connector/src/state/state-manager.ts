/**
 * ------------------------------------------------------------------------
 * 名称：连接器状态管理器
 * 说明：统一维护连接器状态文案与状态快照构建逻辑。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-20
 * 备注：仅处理状态数据，不处理日志与传输层。
 * ------------------------------------------------------------------------
 */

import type { BridgeRole } from '../bridge/protocol.ts';
import type { ConnectionStatusSnapshot } from './status-store.ts';

/**
 * 连接器状态管理器。
 */
export class ConnectorStateManager {
	public static readonly text = {
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

	/**
	 * 生成连接中状态。
	 * @returns 连接状态快照。
	 */
	public createConnectingSnapshot(): ConnectionStatusSnapshot {
		return {
			bridgeType: 'connecting',
			bridgeText: ConnectorStateManager.text.connectingWaiting,
			websocketType: 'connecting',
			websocketText: ConnectorStateManager.text.websocketConnecting,
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * 生成角色状态。
	 * @param role 当前角色。
	 * @param displayClientId 当前客户端标识。
	 * @param displayActiveClientId 当前活动客户端标识。
	 * @returns 连接状态快照。
	 */
	public createRoleSnapshot(role: BridgeRole, displayClientId: string, displayActiveClientId: string): ConnectionStatusSnapshot {
		const websocketText = displayClientId.length > 0
			? `${ConnectorStateManager.text.currentClientPrefix}${displayClientId}`
			: ConnectorStateManager.text.connected;

		if (role === 'active') {
			return {
				bridgeType: 'connected',
				bridgeText: ConnectorStateManager.text.connected,
				websocketType: 'connected',
				websocketText,
				updatedAt: new Date().toISOString(),
			};
		}

		const activeLabel = displayActiveClientId.length > 0
			? `${ConnectorStateManager.text.activeClientPrefix}${displayActiveClientId}`
			: ConnectorStateManager.text.standby;
		return {
			bridgeType: 'connecting',
			bridgeText: activeLabel,
			websocketType: 'connected',
			websocketText,
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * 生成连接失败状态。
	 * @param detail 失败详情。
	 * @returns 连接状态快照。
	 */
	public createFailedSnapshot(detail: string): ConnectionStatusSnapshot {
		const normalizedDetail = String(detail ?? '').trim() || ConnectorStateManager.text.connectFailedRetryDetail;
		return {
			bridgeType: 'error',
			bridgeText: ConnectorStateManager.text.connectFailed,
			websocketType: 'error',
			websocketText: normalizedDetail,
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * 生成未在编辑页时的待连接状态。
	 * @returns 连接状态快照。
	 */
	public createNotEditablePageSnapshot(): ConnectionStatusSnapshot {
		return {
			bridgeType: 'connecting',
			bridgeText: ConnectorStateManager.text.disconnected,
			websocketType: 'connecting',
			websocketText: ConnectorStateManager.text.disconnected,
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * 计算桥接状态展示文本。
	 * @param bridgeType 桥接状态类型。
	 * @param bridgeText 桥接状态文案。
	 * @returns 展示文本。
	 */
	public getBridgeDisplayText(bridgeType: ConnectionStatusSnapshot['bridgeType'], bridgeText: string): string {
		if (bridgeType === 'connected' && bridgeText === ConnectorStateManager.text.connected) {
			return `${ConnectorStateManager.text.connected}。`;
		}

		return bridgeText;
	}

	/**
	 * 判断桥接文案是否为“等待连接”样式。
	 * @param bridgeType 桥接状态类型。
	 * @param bridgeText 桥接状态文案。
	 * @returns 是否为等待文案。
	 */
	public isBridgeWaitingMessage(bridgeType: ConnectionStatusSnapshot['bridgeType'], bridgeText: string): boolean {
		return bridgeType === 'connecting' && bridgeText === ConnectorStateManager.text.connectingWaiting;
	}

	/**
	 * 判断 WebSocket 文案是否为“等待连接”样式。
	 * @param websocketType websocket 状态类型。
	 * @param websocketText websocket 状态文案。
	 * @returns 是否为等待文案。
	 */
	public isSocketWaitingMessage(websocketType: ConnectionStatusSnapshot['websocketType'], websocketText: string): boolean {
		return websocketType === 'connecting' && websocketText === ConnectorStateManager.text.websocketConnecting;
	}
}
