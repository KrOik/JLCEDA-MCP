/**
 * ------------------------------------------------------------------------
 * 名称：Runtime 宿主 IPC 客户端
 * 说明：为 stdio Runtime 提供到扩展宿主的事件驱动异步 IPC 通道。
 * 作者：Codex
 * 日期：2026-04-21
 * 备注：替换状态文件写入、交互文件轮询与 flag 文件监听。
 * ------------------------------------------------------------------------
 */

import * as net from 'net';
import type { RuntimeStatusSnapshot } from '../state/status';
import type { SidebarInteractionRequest, SidebarInteractionResponse } from '../state/sidebar-interaction';
import {
	isHostToRuntimeMessage,
	type HostToRuntimeMessage,
	type RuntimeToHostMessage,
} from './host-runtime-contract';

function writeMessage(socket: net.Socket, message: RuntimeToHostMessage): void {
	socket.write(`${JSON.stringify(message)}\n`);
}

export class RuntimeHostClient {
	private socket: net.Socket | undefined;
	private reconnectTimer: NodeJS.Timeout | undefined;
	private buffer = '';
	private readonly responseQueues = new Map<string, SidebarInteractionResponse[]>();
	private readonly pendingWaiters = new Map<string, Array<{
		acceptedActions: SidebarInteractionResponse['action'][];
		resolve: (response: SidebarInteractionResponse) => void;
		reject: (error: Error) => void;
		timer: NodeJS.Timeout;
	}>>();

	public constructor(
		private readonly endpoint: string,
		private readonly sessionId: string,
		private readonly onSettingsSync: (payload: { exposeRawApiTools: boolean; agentInstructions: string }) => void,
	) {}

	public start(): void {
		this.connect();
	}

	public dispose(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.socket?.destroy();
		this.socket = undefined;
		this.responseQueues.clear();
		for (const waiters of this.pendingWaiters.values()) {
			for (const waiter of waiters) {
				clearTimeout(waiter.timer);
				waiter.reject(new Error('宿主 IPC 通道已关闭。'));
			}
		}
		this.pendingWaiters.clear();
	}

	public publishStatus(snapshot: RuntimeStatusSnapshot): void {
		this.send({
			type: 'runtime/status',
			snapshot,
		});
	}

	public publishInteraction(request: SidebarInteractionRequest | null): void {
		this.send({
			type: 'runtime/interaction',
			request,
		});
	}

	public tryConsumeInteractionResponse(
		requestId: string,
		acceptedActions: SidebarInteractionResponse['action'][],
	): SidebarInteractionResponse | null {
		const queue = this.responseQueues.get(requestId);
		if (!queue || queue.length < 1) {
			return null;
		}

		const index = queue.findIndex(response => acceptedActions.includes(response.action));
		if (index < 0) {
			return null;
		}

		const [response] = queue.splice(index, 1);
		if (queue.length < 1) {
			this.responseQueues.delete(requestId);
		}
		return response;
	}

	public waitForInteractionResponse(
		requestId: string,
		acceptedActions: SidebarInteractionResponse['action'][],
		timeoutMs: number,
	): Promise<SidebarInteractionResponse> {
		return new Promise((resolve, reject) => {
			const existing = this.tryConsumeInteractionResponse(requestId, acceptedActions);
			if (existing) {
				resolve(existing);
				return;
			}

			const timer = setTimeout(() => {
				const waiters = this.pendingWaiters.get(requestId) ?? [];
				this.pendingWaiters.set(requestId, waiters.filter(waiter => waiter.timer !== timer));
				reject(new Error('侧边栏交互等待超时，请重新发起当前工具调用。'));
			}, timeoutMs);
			const waiters = this.pendingWaiters.get(requestId) ?? [];
			waiters.push({ acceptedActions, resolve, reject, timer });
			this.pendingWaiters.set(requestId, waiters);
		});
	}

	private connect(): void {
		const socket = net.createConnection(this.endpoint);
		this.socket = socket;
		this.buffer = '';
		socket.setEncoding('utf8');
		socket.on('connect', () => {
			this.send({
				type: 'runtime/hello',
				sessionId: this.sessionId,
				sentAt: new Date().toISOString(),
			});
		});
		socket.on('data', (chunk: string | Buffer) => {
			this.consumeChunk(String(chunk ?? ''));
		});
		socket.on('error', () => {
			// 统一通过 close 进入重连逻辑。
		});
		socket.on('close', () => {
			if (this.socket === socket) {
				this.socket = undefined;
				this.scheduleReconnect();
			}
		});
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer) {
			return;
		}

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			this.connect();
		}, 1000);
	}

	private send(message: RuntimeToHostMessage): void {
		if (!this.socket || this.socket.destroyed) {
			return;
		}

		writeMessage(this.socket, message);
	}

	private consumeChunk(chunk: string): void {
		this.buffer += chunk;
		let lineBreakIndex = this.buffer.indexOf('\n');
		while (lineBreakIndex >= 0) {
			const line = this.buffer.slice(0, lineBreakIndex).trim();
			this.buffer = this.buffer.slice(lineBreakIndex + 1);
			if (line.length > 0) {
				this.handleLine(line);
			}
			lineBreakIndex = this.buffer.indexOf('\n');
		}
	}

	private handleLine(line: string): void {
		try {
			const parsed = JSON.parse(line) as unknown;
			if (!isHostToRuntimeMessage(parsed)) {
				return;
			}

			this.handleMessage(parsed);
		}
		catch {
			// 非法消息忽略。
		}
	}

	private handleMessage(message: HostToRuntimeMessage): void {
		if (message.type === 'host/sync-settings') {
			this.onSettingsSync({
				exposeRawApiTools: message.exposeRawApiTools,
				agentInstructions: message.agentInstructions,
			});
			return;
		}

		if (message.type === 'host/interaction-response') {
			const waiters = this.pendingWaiters.get(message.response.requestId) ?? [];
			const waiter = waiters.find(candidate => candidate.acceptedActions.includes(message.response.action));
			if (waiter) {
				clearTimeout(waiter.timer);
				this.pendingWaiters.set(
					message.response.requestId,
					waiters.filter(candidate => candidate !== waiter),
				);
				waiter.resolve(message.response);
				return;
			}

			const queue = this.responseQueues.get(message.response.requestId) ?? [];
			queue.push(message.response);
			this.responseQueues.set(message.response.requestId, queue);
		}
	}
}
