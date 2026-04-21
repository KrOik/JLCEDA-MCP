/**
 * ------------------------------------------------------------------------
 * 名称：宿主运行时 IPC 服务
 * 说明：负责扩展宿主与 stdio Runtime 之间的事件驱动异步通信。
 * 作者：KrOik
 * 日期：2026-04-21
 * 备注：用于替换本地 JSON 文件 + 轮询链路。
 * ------------------------------------------------------------------------
 */

import * as fs from 'fs';
import * as net from 'net';
import * as vscode from 'vscode';
import type { RuntimeStatusSnapshot } from '../state/status';
import { isRuntimeStatusSnapshotStale } from '../state/runtime-status';
import type { SidebarInteractionRequest, SidebarInteractionResponse } from '../state/sidebar-interaction';
import {
	isRuntimeToHostMessage,
	type HostToRuntimeMessage,
	type RuntimeToHostMessage,
} from './host-runtime-contract';

function writeMessage(socket: net.Socket, message: HostToRuntimeMessage): void {
	socket.write(`${JSON.stringify(message)}\n`);
}

export class HostRuntimeBridge implements vscode.Disposable {
	private readonly snapshotEmitter = new vscode.EventEmitter<RuntimeStatusSnapshot | undefined>();
	private readonly interactionEmitter = new vscode.EventEmitter<SidebarInteractionRequest | null>();
	private readonly connectionEmitter = new vscode.EventEmitter<boolean>();
	private server: net.Server | undefined;
	private socket: net.Socket | undefined;
	private latestSnapshot: RuntimeStatusSnapshot | undefined;
	private currentInteraction: SidebarInteractionRequest | null = null;
	private exposeRawApiTools = false;
	private agentInstructions = '';
	private buffer = '';

	public constructor(private readonly endpoint: string) {}

	public get onDidSnapshotChange(): vscode.Event<RuntimeStatusSnapshot | undefined> {
		return this.snapshotEmitter.event;
	}

	public get onDidInteractionChange(): vscode.Event<SidebarInteractionRequest | null> {
		return this.interactionEmitter.event;
	}

	public get onDidConnectionChange(): vscode.Event<boolean> {
		return this.connectionEmitter.event;
	}

	public start(): void {
		if (this.server) {
			return;
		}

		if (process.platform !== 'win32' && fs.existsSync(this.endpoint)) {
			fs.rmSync(this.endpoint, { force: true });
		}

		this.server = net.createServer((socket) => {
			this.attachSocket(socket);
		});
		this.server.on('error', () => {
			this.socket?.destroy();
			this.socket = undefined;
			this.latestSnapshot = undefined;
			this.currentInteraction = null;
			this.snapshotEmitter.fire(undefined);
			this.interactionEmitter.fire(null);
			this.connectionEmitter.fire(false);
		});
		this.server.listen(this.endpoint);
	}

	public getLatestSnapshot(): RuntimeStatusSnapshot | undefined {
		if (!this.latestSnapshot) {
			return undefined;
		}

		return isRuntimeStatusSnapshotStale(this.latestSnapshot)
			? undefined
			: this.latestSnapshot;
	}

	public getCurrentInteraction(): SidebarInteractionRequest | null {
		return this.currentInteraction;
	}

	public updateSettings(exposeRawApiTools: boolean, agentInstructions: string): void {
		this.exposeRawApiTools = exposeRawApiTools;
		this.agentInstructions = agentInstructions;
		this.pushSettings();
	}

	public sendInteractionResponse(response: SidebarInteractionResponse): void {
		if (!this.socket || this.socket.destroyed) {
			return;
		}

		writeMessage(this.socket, {
			type: 'host/interaction-response',
			response,
		});
	}

	public dispose(): void {
		this.socket?.destroy();
		this.server?.close();
		if (process.platform !== 'win32' && fs.existsSync(this.endpoint)) {
			fs.rmSync(this.endpoint, { force: true });
		}
		this.snapshotEmitter.dispose();
		this.interactionEmitter.dispose();
		this.connectionEmitter.dispose();
	}

	private attachSocket(socket: net.Socket): void {
		this.socket?.destroy();
		this.socket = socket;
		this.buffer = '';
		this.connectionEmitter.fire(true);
		this.pushSettings();

		socket.setEncoding('utf8');
		socket.on('data', (chunk: string | Buffer) => {
			this.consumeChunk(String(chunk ?? ''));
		});
		socket.on('close', () => {
			if (this.socket === socket) {
				this.socket = undefined;
				this.latestSnapshot = undefined;
				this.currentInteraction = null;
				this.snapshotEmitter.fire(undefined);
				this.interactionEmitter.fire(null);
				this.connectionEmitter.fire(false);
			}
		});
		socket.on('error', () => {
			// 统一在 close 中处理状态收口。
		});
	}

	private pushSettings(): void {
		if (!this.socket || this.socket.destroyed) {
			return;
		}

		writeMessage(this.socket, {
			type: 'host/sync-settings',
			exposeRawApiTools: this.exposeRawApiTools,
			agentInstructions: this.agentInstructions,
		});
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
			if (!isRuntimeToHostMessage(parsed)) {
				return;
			}

			this.handleMessage(parsed);
		}
		catch {
			// 非法消息静默丢弃，避免 IPC 噪声影响主流程。
		}
	}

	private handleMessage(message: RuntimeToHostMessage): void {
		if (message.type === 'runtime/status') {
			this.latestSnapshot = message.snapshot;
			this.snapshotEmitter.fire(this.latestSnapshot);
			return;
		}

		if (message.type === 'runtime/interaction') {
			this.currentInteraction = message.request;
			this.interactionEmitter.fire(this.currentInteraction);
		}
	}
}
