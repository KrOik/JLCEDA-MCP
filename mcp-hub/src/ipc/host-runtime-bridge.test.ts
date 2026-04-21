import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
	class EventEmitter<T> {
		private readonly listeners = new Set<(value: T) => void>();

		public readonly event = (listener: (value: T) => void) => {
			this.listeners.add(listener);
			return {
				dispose: () => {
					this.listeners.delete(listener);
				},
			};
		};

		public fire(value: T): void {
			for (const listener of this.listeners) {
				listener(value);
			}
		}

		public dispose(): void {
			this.listeners.clear();
		}
	}

	return { EventEmitter };
});

import type { RuntimeStatusSnapshot } from '../state/status';
import { HostRuntimeBridge } from './host-runtime-bridge';
import { createHostRuntimeIpcEndpoint } from './host-runtime-endpoint';
import { RuntimeHostClient } from './runtime-host-client';

function waitFor<T>(factory: () => T | undefined, timeoutMs = 2000): Promise<T> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const poll = () => {
			const value = factory();
			if (value !== undefined) {
				resolve(value);
				return;
			}
			if (Date.now() - startedAt >= timeoutMs) {
				reject(new Error('timeout'));
				return;
			}
			setTimeout(poll, 20);
		};
		poll();
	});
}

describe('HostRuntimeBridge', () => {
	let bridge: HostRuntimeBridge | undefined;
	let client: RuntimeHostClient | undefined;

	beforeEach(() => {
		const endpoint = createHostRuntimeIpcEndpoint(
			`test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			'C:/workspace/jlceda-mcp',
		);
		bridge = new HostRuntimeBridge(endpoint);
		bridge.start();
		client = new RuntimeHostClient(endpoint, 'session-a', () => {
			return;
		});
		client.start();
	});

	afterEach(() => {
		client?.dispose();
		bridge?.dispose();
	});

	it('synchronizes runtime status and interaction messages over IPC', async () => {
		const snapshot: RuntimeStatusSnapshot = {
			host: '127.0.0.1',
			port: 8765,
			httpPort: 7655,
			runtimeStatus: 'running',
			runtimeMessage: '运行中！',
			bridgeClientCount: 1,
			bridgeClientIds: ['client-a'],
			bridgeLogs: [],
			bridgeVersionMismatch: null,
			lastErrorMessage: '',
			lastDisconnect: null,
			updatedAt: new Date().toISOString(),
		};

		client!.publishStatus(snapshot);
		const receivedSnapshot = await waitFor(() => bridge!.getLatestSnapshot());
		expect(receivedSnapshot).toMatchObject(snapshot);

		client!.publishInteraction({
			kind: 'component-select',
			requestId: 'req-1',
			keyword: 'STM32',
			title: '器件选型',
			description: '请选择器件',
			noticeText: '',
			candidates: [],
			pageSize: 20,
			currentPage: 1,
			timeoutSeconds: 60,
		});
		const interaction = await waitFor(() => bridge!.getCurrentInteraction() ?? undefined);
		expect(interaction?.requestId).toBe('req-1');
	});

	it('delivers interaction responses back to the runtime client', async () => {
		client!.publishInteraction({
			kind: 'component-place',
			requestId: 'req-2',
			title: '原理图器件放置',
			description: '请放置器件',
			noticeText: '',
			totalCount: 1,
			placedCount: 0,
			statusText: '等待开始',
			timeoutSeconds: 60,
			retryCount: 1,
			started: false,
			canStart: true,
			canCancel: true,
			rows: [],
		});
		await waitFor(() => bridge!.getCurrentInteraction() ?? undefined);

		const pendingResponse = client!.waitForInteractionResponse('req-2', ['start-placement'], 1000);
		bridge!.sendInteractionResponse({
			requestId: 'req-2',
			action: 'start-placement',
		});

		await expect(pendingResponse).resolves.toEqual({
			requestId: 'req-2',
			action: 'start-placement',
		});
	});
});
