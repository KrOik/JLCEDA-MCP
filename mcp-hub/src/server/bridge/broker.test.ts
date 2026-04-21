import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import type * as Broker from './broker';

type BrokerModule = typeof Broker;

function decodeJson(data: WebSocket.RawData): unknown {
	if (typeof data === 'string') {
		return JSON.parse(data);
	}
	if (Buffer.isBuffer(data)) {
		return JSON.parse(data.toString('utf8'));
	}
	if (Array.isArray(data)) {
		return JSON.parse(Buffer.concat(data).toString('utf8'));
	}
	return JSON.parse(Buffer.from(data).toString('utf8'));
}

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

class BridgeTestClient {
	private readonly messages: Array<Record<string, unknown>> = [];

	private constructor(private readonly socket: WebSocket) {
		this.socket.on('message', (data) => {
			this.messages.push(decodeJson(data) as Record<string, unknown>);
		});
	}

	public static async connect(url: string): Promise<BridgeTestClient> {
		const socket = new WebSocket(url);
		await new Promise<void>((resolve, reject) => {
			socket.once('open', () => resolve());
			socket.once('error', reject);
		});
		return new BridgeTestClient(socket);
	}

	public send(message: Record<string, unknown>): void {
		this.socket.send(JSON.stringify(message));
	}

	public async waitForMessage<T extends Record<string, unknown>>(
		predicate: (message: Record<string, unknown>) => message is T,
		timeoutMs = 2000,
	): Promise<T> {
		return await waitFor(() => {
			return this.messages.find(predicate);
		}, timeoutMs);
	}

	public getMessages(): ReadonlyArray<Record<string, unknown>> {
		return this.messages;
	}

	public async close(code = 1000, reason = 'bye'): Promise<void> {
		if (this.socket.readyState === WebSocket.CLOSED) {
			return;
		}

		await new Promise<void>((resolve) => {
			this.socket.once('close', () => resolve());
			this.socket.close(code, reason);
		});
	}
}

async function loadFreshBroker(debugSwitchValues?: {
	enableSystemLog: boolean;
	enableConnectionList: boolean;
	enableDebugControlCard: boolean;
}): Promise<BrokerModule> {
	vi.resetModules();
	if (debugSwitchValues) {
		const { updateDebugSwitch } = await import('../../debug');
		updateDebugSwitch(debugSwitchValues);
	}
	return await import('./broker');
}

async function updateDebugSwitchValues(values: {
	enableSystemLog: boolean;
	enableConnectionList: boolean;
	enableDebugControlCard: boolean;
}): Promise<void> {
	const { updateDebugSwitch } = await import('../../debug');
	updateDebugSwitch(values);
}

async function createBrokerServer(broker: BrokerModule): Promise<{ server: WebSocketServer; url: string }> {
	const server = new WebSocketServer({ port: 0 });
	server.on('connection', (socket) => {
		broker.attachBridgeClientSocket(socket);
	});

	await new Promise<void>((resolve) => server.once('listening', () => resolve()));

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('unable to bind websocket server');
	}

	return {
		server,
		url: `ws://127.0.0.1:${address.port}`,
	};
}

async function closeBrokerServer(server: WebSocketServer | undefined): Promise<void> {
	if (!server) {
		return;
	}

	for (const client of server.clients) {
		client.terminate();
	}

	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

describe('bridge broker', () => {
	let server: WebSocketServer | undefined;
	let clients: BridgeTestClient[] = [];

	afterEach(async () => {
		await Promise.all(clients.map(async (client) => client.close().catch(() => undefined)));
		clients = [];
		await closeBrokerServer(server);
		server = undefined;
		await updateDebugSwitchValues({
			enableSystemLog: false,
			enableConnectionList: false,
			enableDebugControlCard: false,
		});
	});

	it('returns a wait-active-peer timeout result when no ready bridge client exists', async () => {
		const broker = await loadFreshBroker();

		const result = await broker.enqueueBridgeRequest('/bridge/jlceda/context', { scope: 'sch' }, 25) as {
			timeout: boolean;
			timeoutType: string;
			path: string;
		};

		expect(result).toMatchObject({
			timeout: true,
			timeoutType: 'wait_active_peer',
			path: '/bridge/jlceda/context',
		});
		expect(broker.getBridgeStatus()).toEqual({
			connectedClients: 0,
			pendingRequests: 0,
			clientIds: [],
		});
	});

	it('routes tasks to the active peer and fails over to a standby peer after disconnect', async () => {
		const broker = await loadFreshBroker();
		const brokerServer = await createBrokerServer(broker);
		server = brokerServer.server;

		const clientA = await BridgeTestClient.connect(brokerServer.url);
		const clientB = await BridgeTestClient.connect(brokerServer.url);
		clients.push(clientA, clientB);

		clientA.send({
			type: 'bridge/hello',
			clientId: 'client-a',
			bridgeVersion: '1.5.5',
		});
		clientB.send({
			type: 'bridge/hello',
			clientId: 'client-b',
			bridgeVersion: '1.5.5',
		});
		clientA.send({
			type: 'bridge/ready',
			clientId: 'client-a',
			readyAt: Date.now(),
		});
		clientB.send({
			type: 'bridge/ready',
			clientId: 'client-b',
			readyAt: Date.now(),
		});

		await clientA.waitForMessage((message): message is Record<string, unknown> => {
			return message.type === 'bridge/role' && message.role === 'active';
		});
		await clientB.waitForMessage((message): message is Record<string, unknown> => {
			return message.type === 'bridge/role' && message.role === 'standby';
		});

		const firstResultPromise = broker.enqueueBridgeRequest('/bridge/test/echo', { seq: 1 }, 500);
		const firstTask = await clientA.waitForMessage((message): message is {
			type: 'bridge/task';
			requestId: string;
			leaseTerm: number;
			payload: { seq: number };
		} => {
			return message.type === 'bridge/task';
		});

		expect(firstTask.payload).toEqual({ seq: 1 });
		clientA.send({
			type: 'bridge/result',
			clientId: 'client-a',
			requestId: firstTask.requestId,
			leaseTerm: firstTask.leaseTerm,
			result: { handledBy: 'client-a' },
		});

		await expect(firstResultPromise).resolves.toEqual({ handledBy: 'client-a' });

		await clientA.close(1000, 'handover');
		await waitFor(() => {
			const status = broker.getBridgeStatus();
			if (status.connectedClients === 1 && status.clientIds[0] === 'client-b') {
				return status;
			}
			return undefined;
		});

		const secondResultPromise = broker.enqueueBridgeRequest('/bridge/test/echo', { seq: 2 }, 500);
		const secondTask = await clientB.waitForMessage((message): message is {
			type: 'bridge/task';
			requestId: string;
			leaseTerm: number;
			payload: { seq: number };
		} => {
			return message.type === 'bridge/task' && (message.payload as { seq?: number }).seq === 2;
		});

		clientB.send({
			type: 'bridge/result',
			clientId: 'client-b',
			requestId: secondTask.requestId,
			leaseTerm: secondTask.leaseTerm,
			result: { handledBy: 'client-b' },
		});

		await expect(secondResultPromise).resolves.toEqual({ handledBy: 'client-b' });
		expect(broker.getBridgeStatus()).toEqual({
			connectedClients: 1,
			pendingRequests: 0,
			clientIds: ['client-b'],
		});
	});

	it('returns a wait-result timeout when the active peer never completes the task', async () => {
		const broker = await loadFreshBroker();
		const brokerServer = await createBrokerServer(broker);
		server = brokerServer.server;

		const client = await BridgeTestClient.connect(brokerServer.url);
		clients.push(client);

		client.send({
			type: 'bridge/hello',
			clientId: 'client-timeout',
			bridgeVersion: '1.5.5',
		});
		client.send({
			type: 'bridge/ready',
			clientId: 'client-timeout',
			readyAt: Date.now(),
		});

		await client.waitForMessage((message): message is Record<string, unknown> => {
			return message.type === 'bridge/role' && message.role === 'active';
		});

		const timeoutResultPromise = broker.enqueueBridgeRequest('/bridge/test/slow', { seq: 99 }, 60);
		await client.waitForMessage((message): message is Record<string, unknown> => {
			return message.type === 'bridge/task';
		});

		const timeoutResult = await timeoutResultPromise as {
			timeout: boolean;
			timeoutType: string;
			message: string;
		};

		expect(timeoutResult).toMatchObject({
			timeout: true,
			timeoutType: 'wait_result',
		});
		expect(timeoutResult.message).toContain('/bridge/test/slow');
		expect(broker.getBridgeStatus().pendingRequests).toBe(0);
	});

	it('sends debug switch state and reports bridge/server version mismatch on hello', async () => {
		const broker = await loadFreshBroker({
			enableSystemLog: true,
			enableConnectionList: true,
			enableDebugControlCard: false,
		});
		const versionMismatchHandler = vi.fn();
		broker.setServerVersion('1.5.5');
		broker.setVersionMismatchHandler(versionMismatchHandler);

		const brokerServer = await createBrokerServer(broker);
		server = brokerServer.server;

		const client = await BridgeTestClient.connect(brokerServer.url);
		clients.push(client);

		client.send({
			type: 'bridge/hello',
			clientId: 'client-version-mismatch',
			bridgeVersion: '1.5.4',
		});

		const debugSwitchMessage = await client.waitForMessage((message): message is {
			type: 'bridge/debug-switch';
			debugSwitch: {
				enableSystemLog: boolean;
				enableConnectionList: boolean;
			};
		} => {
			return message.type === 'bridge/debug-switch';
		});

		expect(debugSwitchMessage.debugSwitch).toEqual({
			enableSystemLog: true,
			enableConnectionList: true,
		});
		expect(versionMismatchHandler).toHaveBeenCalledWith({
			bridgeVersion: '1.5.4',
			serverVersion: '1.5.5',
			lowerSide: 'bridge',
		});
	});

	it('returns bridge errors for unsupported client messages and invalid client log payloads', async () => {
		const broker = await loadFreshBroker();
		const brokerServer = await createBrokerServer(broker);
		server = brokerServer.server;

		const client = await BridgeTestClient.connect(brokerServer.url);
		clients.push(client);

		client.send({
			type: 'bridge/hello',
			clientId: 'client-invalid-message',
			bridgeVersion: '1.5.5',
		});
		await client.waitForMessage((message): message is Record<string, unknown> => {
			return message.type === 'bridge/welcome';
		});

		client.send({
			type: 'bridge/not-supported',
			clientId: 'client-invalid-message',
		});

		const unsupportedMessageError = await waitFor(() => {
			return client.getMessages().find((message): message is {
				type: 'bridge/error';
				message: string;
			} => {
				return message.type === 'bridge/error'
					&& typeof message.message === 'string'
					&& message.message.includes('收到未知客户端消息类型');
			});
		});

		expect(unsupportedMessageError.message).toContain('bridge/not-supported');

		client.send({
			type: 'bridge/log',
			clientId: 'client-invalid-message',
			log: { invalid: true },
		});

		const invalidLogError = await waitFor(() => {
			return client.getMessages().find((message): message is {
				type: 'bridge/error';
				message: string;
			} => {
				return message.type === 'bridge/error'
					&& typeof message.message === 'string'
					&& message.message.includes('客户端日志结构非法。');
			});
		});

		expect(invalidLogError.message).toContain('客户端日志结构非法。');
	});

	it('flushes valid client logs when system log is enabled', async () => {
		const broker = await loadFreshBroker({
			enableSystemLog: true,
			enableConnectionList: true,
			enableDebugControlCard: false,
		});
		const brokerServer = await createBrokerServer(broker);
		server = brokerServer.server;

		const client = await BridgeTestClient.connect(brokerServer.url);
		clients.push(client);

		client.send({
			type: 'bridge/hello',
			clientId: 'client-log',
			bridgeVersion: '1.5.5',
		});
		await client.waitForMessage((message): message is Record<string, unknown> => {
			return message.type === 'bridge/welcome';
		});

		client.send({
			type: 'bridge/log',
			clientId: 'client-log',
			log: {
				id: 'log-1',
				timestamp: new Date().toISOString(),
				level: 'info',
				fields: {
					source: 'client',
					event: 'bridge.test.log',
					summary: 'client log summary',
					message: 'client log message',
				},
			},
		});

		const flushedLogs = await waitFor(() => {
			const logs = broker.flushBridgeLogs();
			if (logs.length > 0) {
				return logs;
			}
			return undefined;
		});

		expect(flushedLogs).toHaveLength(1);
		expect(flushedLogs[0]).toMatchObject({
			id: 'log-1',
			level: 'info',
			fields: {
				event: 'bridge.test.log',
				summary: 'client log summary',
				message: 'client log message',
			},
		});
		expect(broker.flushBridgeLogs()).toEqual([]);
	});
});
