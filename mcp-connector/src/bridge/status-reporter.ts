/**
 * ------------------------------------------------------------------------
 * 名称：桥接状态报告器
 * 说明：统一写入连接状态快照，供设置页轮询展示。
 * 作者：Lion
 * 邮筱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：该模块只负责状态写入，不负责网络连接。
 * ------------------------------------------------------------------------
 */

import type { BridgeRole } from './protocol.ts';
import { CONNECTOR_STATUS_TEXT } from '../status-log.ts';
import { saveConnectionStatus } from './status-store.ts';

export class BridgeStatusReporter {
	/**
	 * 标记连接初始化中。
	 */
	public markConnecting(): void {
		saveConnectionStatus({
			bridgeType: 'connecting',
			bridgeText: CONNECTOR_STATUS_TEXT.connectingWaiting,
			websocketType: 'connecting',
			websocketText: CONNECTOR_STATUS_TEXT.websocketConnecting,
			updatedAt: new Date().toISOString(),
		});
	}

	/**
	 * 标记当前角色状态。
	 * @param role 服务端裁决的角色。
	 * @param displayClientId 服务端分配的本客户端展示标识。
	 * @param displayActiveClientId 服务端分配的活动客户端展示标识。
	 */
	public markRole(role: BridgeRole, displayClientId: string, displayActiveClientId: string): void {
		const websocketText = displayClientId.length > 0
			? `${CONNECTOR_STATUS_TEXT.currentClientPrefix}${displayClientId}`
			: CONNECTOR_STATUS_TEXT.connected;

		if (role === 'active') {
			saveConnectionStatus({
				bridgeType: 'connected',
				bridgeText: CONNECTOR_STATUS_TEXT.connected,
				websocketType: 'connected',
				websocketText,
				updatedAt: new Date().toISOString(),
			});
		}
		else {
			const activeLabel = displayActiveClientId.length > 0
				? `${CONNECTOR_STATUS_TEXT.activeClientPrefix}${displayActiveClientId}`
				: CONNECTOR_STATUS_TEXT.standby;
			saveConnectionStatus({
				bridgeType: 'connecting',
				bridgeText: activeLabel,
				websocketType: 'connected',
				websocketText,
				updatedAt: new Date().toISOString(),
			});
		}
	}

	/**
	 * 标记连接失败。
	 * @param detail 失败说明。
	 */
	public markFailed(detail: string): void {
		const normalizedDetail = String(detail ?? '').trim() || CONNECTOR_STATUS_TEXT.connectFailedRetryDetail;
		saveConnectionStatus({
			bridgeType: 'error',
			bridgeText: CONNECTOR_STATUS_TEXT.connectFailed,
			websocketType: 'error',
			websocketText: normalizedDetail,
			updatedAt: new Date().toISOString(),
		});
	}

	/**
	 * 标记当前页面不是原理图或 PCB 编辑页，连接已暂停。
	 */
	public markNotOnEditablePage(): void {
		saveConnectionStatus({
			bridgeType: 'connecting',
			bridgeText: CONNECTOR_STATUS_TEXT.disconnected,
			websocketType: 'connecting',
			websocketText: CONNECTOR_STATUS_TEXT.disconnected,
			updatedAt: new Date().toISOString(),
		});
	}
}
