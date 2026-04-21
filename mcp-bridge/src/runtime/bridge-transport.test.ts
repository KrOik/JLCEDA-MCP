import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RegisteredSocketCallbacks {
	onMessage: (event: { data: unknown }) => void | Promise<void>;
	onOpen: () => void;
	url: string;
}

function installEdaWebSocketMock() {
	const sockets = new Map<string, RegisteredSocketCallbacks>();
	const register = vi.fn((socketId: string, url: string, onMessage: RegisteredSocketCallbacks['onMessage'], onOpen: RegisteredSocketCallbacks['onOpen']) => {
		sockets.set(socketId, { onMessage, onOpen, url });
	});
	const send = vi.fn();
	const close = vi.fn();

	(globalThis as typeof globalThis & {
		eda?: {
			sys_WebSocket: {
				register: typeof register;
				send: typeof send;
				close: typeof close;
			};
		};
	}).eda = {
		sys_WebSocket: {
			register,
			send,
			close,
		},
	};

	return {
		sockets,
		register,
		send,
		close,
	};
}

function sentMessages(send: ReturnType<typeof vi.fn>): Array<{ socketId: string; message: Record<string, unknown> }> {
	return send.mock.calls.map(([socketId, payload]) => ({
		socketId: socketId as string,
		message: JSON.parse(payload as string) as Record<string, unknown>,
	}));
}

describe('bridge transport', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		delete (globalThis as typeof globalThis & { eda?: unknown }).eda;
	});

	it('completes the handshake and dispatches protocol messages to the runtime callbacks', async () => {
		const edaMock = installEdaWebSocketMock();
		const callbacks = {
			onRoleChanged: vi.fn(),
			onDebugSwitchChanged: vi.fn(),
			onTask: vi.fn(),
			onLost: vi.fn(),
		};

		const { BridgeTransport } = await import('./bridge-transport.ts');
		const transport = new BridgeTransport('ws://127.0.0.1:8765/bridge/ws', 'socket-a', 'client-a', '1.5.5', callbacks);

		const connectPromise = transport.connect();
		expect(edaMock.register).toHaveBeenCalledWith(
			'socket-a',
			'ws://127.0.0.1:8765/bridge/ws',
			expect.any(Function),
			expect.any(Function),
		);

		edaMock.sockets.get('socket-a')?.onOpen();
		await Promise.resolve();

		expect(sentMessages(edaMock.send)).toContainEqual({
			socketId: 'socket-a',
			message: {
				type: 'bridge/hello',
				clientId: 'client-a',
				bridgeVersion: '1.5.5',
			},
		});

		await edaMock.sockets.get('socket-a')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/welcome',
				clientId: 'client-a',
				connectedAt: new Date().toISOString(),
			}),
		});
		await expect(connectPromise).resolves.toBeUndefined();

		transport.reportReady();
		expect(sentMessages(edaMock.send)).toContainEqual({
			socketId: 'socket-a',
			message: {
				type: 'bridge/ready',
				clientId: 'client-a',
				readyAt: expect.any(Number),
			},
		});

		await edaMock.sockets.get('socket-a')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/role',
				clientId: 'client-a',
				role: 'active',
				leaseTerm: 2,
				activeClientId: 'client-a',
				reason: 'promoted',
			}),
		});
		await edaMock.sockets.get('socket-a')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/debug-switch',
				clientId: 'client-a',
				debugSwitch: {
					enableSystemLog: true,
					enableConnectionList: false,
				},
			}),
		});
		await edaMock.sockets.get('socket-a')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/task',
				requestId: 'req-1',
				path: '/bridge/jlceda/context',
				payload: { scope: 'sch' },
				createdAt: Date.now(),
				leaseTerm: 2,
			}),
		});

		expect(callbacks.onRoleChanged).toHaveBeenCalledWith({
			type: 'bridge/role',
			clientId: 'client-a',
			role: 'active',
			leaseTerm: 2,
			activeClientId: 'client-a',
			reason: 'promoted',
		});
		expect(callbacks.onDebugSwitchChanged).toHaveBeenCalledWith({
			enableSystemLog: true,
			enableConnectionList: false,
		});
		expect(callbacks.onTask).toHaveBeenCalledWith({
			requestId: 'req-1',
			path: '/bridge/jlceda/context',
			payload: { scope: 'sch' },
			createdAt: expect.any(Number),
			leaseTerm: 2,
		});

		await vi.advanceTimersByTimeAsync(1000);
		expect(sentMessages(edaMock.send)).toContainEqual({
			socketId: 'socket-a',
			message: {
				type: 'bridge/heartbeat',
				clientId: 'client-a',
				sentAt: expect.any(Number),
			},
		});
		expect(callbacks.onLost).not.toHaveBeenCalled();
	});

	it('fails the connection when the websocket open callback never arrives', async () => {
		const edaMock = installEdaWebSocketMock();
		const callbacks = {
			onRoleChanged: vi.fn(),
			onDebugSwitchChanged: vi.fn(),
			onTask: vi.fn(),
			onLost: vi.fn(),
		};

		const { BridgeTransport } = await import('./bridge-transport.ts');
		const transport = new BridgeTransport('ws://127.0.0.1:8765/bridge/ws', 'socket-b', 'client-b', '1.5.5', callbacks);

		const connectPromise = transport.connect();
		const rejection = connectPromise.catch(error => error);
		await vi.advanceTimersByTimeAsync(5000);

		expect(await rejection).toBeInstanceOf(Error);
		expect(callbacks.onLost).toHaveBeenCalledTimes(1);
		expect(edaMock.close).toHaveBeenCalledWith('socket-b', 1011, expect.any(String));
	});

	it('fails the connection when the welcome handshake times out after open', async () => {
		const edaMock = installEdaWebSocketMock();
		const callbacks = {
			onRoleChanged: vi.fn(),
			onDebugSwitchChanged: vi.fn(),
			onTask: vi.fn(),
			onLost: vi.fn(),
		};

		const { BridgeTransport } = await import('./bridge-transport.ts');
		const transport = new BridgeTransport('ws://127.0.0.1:8765/bridge/ws', 'socket-c', 'client-c', '1.5.5', callbacks);

		const connectPromise = transport.connect();
		const rejection = connectPromise.catch(error => error);
		edaMock.sockets.get('socket-c')?.onOpen();
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(5000);

		expect(await rejection).toBeInstanceOf(Error);
		expect(sentMessages(edaMock.send)).toContainEqual({
			socketId: 'socket-c',
			message: {
				type: 'bridge/hello',
				clientId: 'client-c',
				bridgeVersion: '1.5.5',
			},
		});
		expect(callbacks.onLost).toHaveBeenCalledTimes(1);
		expect(edaMock.close).toHaveBeenCalledWith('socket-c', 1011, expect.any(String));
	});

	it('fails an established connection when the server stays idle past the timeout window', async () => {
		const edaMock = installEdaWebSocketMock();
		const callbacks = {
			onRoleChanged: vi.fn(),
			onDebugSwitchChanged: vi.fn(),
			onTask: vi.fn(),
			onLost: vi.fn(),
		};

		const { BridgeTransport } = await import('./bridge-transport.ts');
		const transport = new BridgeTransport('ws://127.0.0.1:8765/bridge/ws', 'socket-d', 'client-d', '1.5.5', callbacks);

		const connectPromise = transport.connect();
		edaMock.sockets.get('socket-d')?.onOpen();
		await Promise.resolve();
		await edaMock.sockets.get('socket-d')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/welcome',
				clientId: 'client-d',
				connectedAt: new Date().toISOString(),
			}),
		});
		await expect(connectPromise).resolves.toBeUndefined();

		await vi.advanceTimersByTimeAsync(5500);

		expect(callbacks.onLost).toHaveBeenCalledTimes(1);
		expect(edaMock.close).toHaveBeenCalledWith('socket-d', 1011, expect.any(String));
	});

	it('fails an established connection when the server sends malformed json', async () => {
		const edaMock = installEdaWebSocketMock();
		const callbacks = {
			onRoleChanged: vi.fn(),
			onDebugSwitchChanged: vi.fn(),
			onTask: vi.fn(),
			onLost: vi.fn(),
		};

		const { BridgeTransport } = await import('./bridge-transport.ts');
		const transport = new BridgeTransport('ws://127.0.0.1:8765/bridge/ws', 'socket-e', 'client-e', '1.5.5', callbacks);

		const connectPromise = transport.connect();
		edaMock.sockets.get('socket-e')?.onOpen();
		await Promise.resolve();
		await edaMock.sockets.get('socket-e')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/welcome',
				clientId: 'client-e',
				connectedAt: new Date().toISOString(),
			}),
		});
		await expect(connectPromise).resolves.toBeUndefined();

		await edaMock.sockets.get('socket-e')?.onMessage({
			data: '{not-valid-json',
		});

		expect(callbacks.onLost).toHaveBeenCalledTimes(1);
		expect(edaMock.close).toHaveBeenCalledWith('socket-e', 1011, expect.any(String));
	});

	it('fails an established connection when the server sends an unknown message type', async () => {
		const edaMock = installEdaWebSocketMock();
		const callbacks = {
			onRoleChanged: vi.fn(),
			onDebugSwitchChanged: vi.fn(),
			onTask: vi.fn(),
			onLost: vi.fn(),
		};

		const { BridgeTransport } = await import('./bridge-transport.ts');
		const transport = new BridgeTransport('ws://127.0.0.1:8765/bridge/ws', 'socket-f', 'client-f', '1.5.5', callbacks);

		const connectPromise = transport.connect();
		edaMock.sockets.get('socket-f')?.onOpen();
		await Promise.resolve();
		await edaMock.sockets.get('socket-f')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/welcome',
				clientId: 'client-f',
				connectedAt: new Date().toISOString(),
			}),
		});
		await expect(connectPromise).resolves.toBeUndefined();

		await edaMock.sockets.get('socket-f')?.onMessage({
			data: JSON.stringify({
				type: 'bridge/unknown',
				clientId: 'client-f',
			}),
		});

		expect(callbacks.onLost).toHaveBeenCalledTimes(1);
		expect(edaMock.close).toHaveBeenCalledWith('socket-f', 1011, expect.any(String));
	});
});
