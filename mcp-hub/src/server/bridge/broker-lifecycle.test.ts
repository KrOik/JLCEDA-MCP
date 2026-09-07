import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { bridgeBrokerState } from './broker-state';
import { cleanupExpiredPeers, registerClient } from './broker-lifecycle';

function resetBridgeBrokerState(): void {
	bridgeBrokerState.requestSequence = 0;
	bridgeBrokerState.disconnectSequence = 0;
	bridgeBrokerState.leaseTerm = 0;
	bridgeBrokerState.activeClientId = '';
	bridgeBrokerState.peersByClientId.clear();
	bridgeBrokerState.clientIdBySocket.clear();
	bridgeBrokerState.pendingRequests.clear();
	bridgeBrokerState.pendingActiveWaiters.clear();
	bridgeBrokerState.disconnectEventHandler = undefined;
	bridgeBrokerState.versionMismatchHandler = undefined;
	bridgeBrokerState.serverVersion = '';
	bridgeBrokerState.isServerShuttingDown = false;
	bridgeBrokerState.lastCleanupAt = 0;
	bridgeBrokerState.bridgeLogPipeline.flush();
}

function createOpenSocket(): WebSocket {
	return {
		readyState: WebSocket.OPEN,
		send: vi.fn(),
		ping: vi.fn(),
	} as unknown as WebSocket;
}

describe('bridge broker lifecycle', () => {
	it('preserves readiness, context and quarantine when a heartbeat registers the same socket', async () => {
		const socket = createOpenSocket();
		const peer = { clientId: 'stable', connectedAt: 1, lastSeenAt: 1, isReady: true, socket,
			context: { documentUuid: 'page', documentType: 'schematic', title: 'Page' }, uncertainRequestId: 'pending' };
		bridgeBrokerState.peersByClientId.set(peer.clientId, peer);
		bridgeBrokerState.clientIdBySocket.set(socket, peer.clientId);
		bridgeBrokerState.activeClientId = peer.clientId;
		expect(await registerClient(peer.clientId, socket)).toBe(peer);
		expect(peer.isReady).toBe(true);
		expect(peer.uncertainRequestId).toBe('pending');
		peer.lastSeenAt = Date.now() - 20000;
		await cleanupExpiredPeers();
		expect(bridgeBrokerState.peersByClientId.get(peer.clientId)).toBe(peer);
	});
	afterEach(() => {
		resetBridgeBrokerState();
		vi.useRealTimers();
	});

	it('removes expired peers that have no in-flight requests', async () => {
		const socket = createOpenSocket();
		const peer = {
			clientId: 'client-idle',
			connectedAt: 1,
			lastSeenAt: Date.now() - 121000,
			isReady: true,
			socket,
		};
		bridgeBrokerState.activeClientId = peer.clientId;
		bridgeBrokerState.peersByClientId.set(peer.clientId, peer);
		bridgeBrokerState.clientIdBySocket.set(socket, peer.clientId);

		await cleanupExpiredPeers();

		expect(bridgeBrokerState.peersByClientId.size).toBe(0);
		expect(bridgeBrokerState.clientIdBySocket.size).toBe(0);
		expect(bridgeBrokerState.activeClientId).toBe('');
	});
	it('keeps a background page whose native websocket responds despite stale application heartbeat', async () => {
		const socket = createOpenSocket();
		const peer = { clientId: 'background', connectedAt: 1, lastSeenAt: Date.now() - 180000, lastPongAt: Date.now(), isReady: true, socket };
		bridgeBrokerState.peersByClientId.set(peer.clientId, peer);
		await cleanupExpiredPeers();
		expect(bridgeBrokerState.peersByClientId.get(peer.clientId)).toBe(peer);
		expect(socket.ping).toHaveBeenCalledTimes(1);
	});

	it('keeps an expired active peer connected while it still owns a pending request', async () => {
		const socket = createOpenSocket();
		const peer = {
			clientId: 'client-busy',
			connectedAt: 1,
			lastSeenAt: Date.now() - 9000,
			isReady: true,
			socket,
		};
		bridgeBrokerState.activeClientId = peer.clientId;
		bridgeBrokerState.peersByClientId.set(peer.clientId, peer);
		bridgeBrokerState.clientIdBySocket.set(socket, peer.clientId);
		bridgeBrokerState.pendingRequests.set('req-1', {
			resolve: vi.fn(),
			reject: vi.fn(),
			timer: setTimeout(() => undefined, 60000),
			clientId: peer.clientId,
			leaseTerm: 3,
			path: '/bridge/jlceda/pcb/snapshot',
		});

		await cleanupExpiredPeers();

		expect(bridgeBrokerState.peersByClientId.get(peer.clientId)).toBe(peer);
		expect(bridgeBrokerState.clientIdBySocket.get(socket)).toBe(peer.clientId);
		expect(bridgeBrokerState.activeClientId).toBe(peer.clientId);
		expect(bridgeBrokerState.pendingRequests.has('req-1')).toBe(true);
	});
});
