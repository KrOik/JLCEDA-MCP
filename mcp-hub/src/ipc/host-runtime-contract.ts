/**
 * ------------------------------------------------------------------------
 * 名称：宿主运行时 IPC 契约
 * 说明：定义扩展宿主、stdio Runtime 与 Sidebar 共享的状态同步协议。
 * 作者：Codex
 * 日期：2026-04-21
 * 备注：状态同步唯一事实源，禁止再回退到本地 JSON 文件通道。
 * ------------------------------------------------------------------------
 */

import type { RuntimeStatusSnapshot } from '../state/status';
import type { SidebarInteractionRequest, SidebarInteractionResponse } from '../state/sidebar-interaction';

export interface RuntimeHelloMessage {
	type: 'runtime/hello';
	sessionId: string;
	sentAt: string;
}

export interface RuntimeStatusMessage {
	type: 'runtime/status';
	snapshot: RuntimeStatusSnapshot;
}

export interface RuntimeInteractionMessage {
	type: 'runtime/interaction';
	request: SidebarInteractionRequest | null;
}

export interface HostSyncSettingsMessage {
	type: 'host/sync-settings';
	exposeRawApiTools: boolean;
	agentInstructions: string;
}

export interface HostInteractionResponseMessage {
	type: 'host/interaction-response';
	response: SidebarInteractionResponse;
}

export type RuntimeToHostMessage =
	| RuntimeHelloMessage
	| RuntimeStatusMessage
	| RuntimeInteractionMessage;

export type HostToRuntimeMessage =
	| HostSyncSettingsMessage
	| HostInteractionResponseMessage;

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isHostToRuntimeMessage(value: unknown): value is HostToRuntimeMessage {
	if (!isPlainObjectRecord(value) || typeof value.type !== 'string') {
		return false;
	}

	if (value.type === 'host/sync-settings') {
		return typeof value.exposeRawApiTools === 'boolean'
			&& typeof value.agentInstructions === 'string';
	}

	if (value.type === 'host/interaction-response') {
		return isPlainObjectRecord(value.response)
			&& typeof value.response.requestId === 'string'
			&& typeof value.response.action === 'string';
	}

	return false;
}

export function isRuntimeToHostMessage(value: unknown): value is RuntimeToHostMessage {
	if (!isPlainObjectRecord(value) || typeof value.type !== 'string') {
		return false;
	}

	if (value.type === 'runtime/hello') {
		return typeof value.sessionId === 'string'
			&& typeof value.sentAt === 'string';
	}

	if (value.type === 'runtime/status') {
		return isPlainObjectRecord(value.snapshot)
			&& typeof value.snapshot.runtimeStatus === 'string'
			&& typeof value.snapshot.runtimeMessage === 'string'
			&& typeof value.snapshot.updatedAt === 'string';
	}

	if (value.type === 'runtime/interaction') {
		return value.request === null || isPlainObjectRecord(value.request);
	}

	return false;
}
