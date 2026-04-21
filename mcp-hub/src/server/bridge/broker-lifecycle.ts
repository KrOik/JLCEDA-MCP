import WebSocket from 'ws';
import { isBridgeProtocolError } from './protocol';
import {
  bridgeBrokerState,
  type BridgeDisconnectEvent,
  type BridgePeerState,
  type RemoveSocketContext,
} from './broker-state';
import {
  BRIDGE_BROKER_TEXT,
  BRIDGE_CLIENT_TTL_MS,
  BridgePeerWaitTimeoutError,
  getBridgeDebugSwitch,
  normalizeDisconnectText,
  nowMs,
  sendBridgeMessage,
} from './broker-transport';

function createDisconnectEventId(clientId: string, disconnectType: string): string {
  bridgeBrokerState.disconnectSequence += 1;
  return `bridge_disconnect_${Date.now()}_${bridgeBrokerState.disconnectSequence}_${clientId}_${disconnectType}`;
}

export function getActivePeer(): BridgePeerState | undefined {
  if (bridgeBrokerState.activeClientId.length === 0) {
    return undefined;
  }

  const peer = bridgeBrokerState.peersByClientId.get(bridgeBrokerState.activeClientId);
  if (!peer) {
    bridgeBrokerState.activeClientId = '';
  }
  return peer;
}

export function getReadyActivePeer(): BridgePeerState | undefined {
  const activePeer = getActivePeer();
  if (!activePeer || !activePeer.isReady) {
    return undefined;
  }

  return activePeer;
}

export function resolveActiveWaiters(): void {
  if (!getReadyActivePeer() || bridgeBrokerState.pendingActiveWaiters.size === 0) {
    return;
  }

  for (const waiter of bridgeBrokerState.pendingActiveWaiters) {
    clearTimeout(waiter.timer);
    bridgeBrokerState.pendingActiveWaiters.delete(waiter);
    waiter.resolve();
  }
}

function rejectPendingRequestsByClient(clientId: string, reason: string): void {
  for (const [requestId, pending] of bridgeBrokerState.pendingRequests.entries()) {
    if (pending.clientId !== clientId) {
      continue;
    }

    clearTimeout(pending.timer);
    bridgeBrokerState.pendingRequests.delete(requestId);
    pending.reject(new Error(reason));
  }
}

export async function sendRoleToPeer(peer: BridgePeerState, reason: string): Promise<void> {
  const role = peer.clientId === bridgeBrokerState.activeClientId ? 'active' : 'standby';
  await sendBridgeMessage(peer.socket, {
    type: 'bridge/role',
    clientId: peer.clientId,
    role,
    leaseTerm: bridgeBrokerState.leaseTerm,
    activeClientId: bridgeBrokerState.activeClientId,
    reason,
  });
}

export async function sendDebugSwitchToPeer(peer: BridgePeerState): Promise<void> {
  await sendBridgeMessage(peer.socket, {
    type: 'bridge/debug-switch',
    clientId: peer.clientId,
    debugSwitch: getBridgeDebugSwitch(),
  });
}

async function broadcastRoles(reason: string): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  for (const peer of bridgeBrokerState.peersByClientId.values()) {
    tasks.push(sendRoleToPeer(peer, reason));
  }

  await Promise.allSettled(tasks);
}

export async function electActivePeer(reason: string): Promise<void> {
  const currentActive = getActivePeer();
  if (currentActive) {
    return;
  }

  const candidates = [...bridgeBrokerState.peersByClientId.values()].sort((left, right) => {
    if (left.connectedAt !== right.connectedAt) {
      return left.connectedAt - right.connectedAt;
    }
    return left.clientId.localeCompare(right.clientId);
  });

  if (candidates.length === 0) {
    bridgeBrokerState.activeClientId = '';
    return;
  }

  bridgeBrokerState.activeClientId = candidates[0].clientId;
  bridgeBrokerState.leaseTerm += 1;
  resolveActiveWaiters();
  await broadcastRoles(reason);
}

function unbindSocket(socket: WebSocket): string {
  const clientId = bridgeBrokerState.clientIdBySocket.get(socket);
  if (!clientId) {
    return '';
  }

  bridgeBrokerState.clientIdBySocket.delete(socket);
  const peer = bridgeBrokerState.peersByClientId.get(clientId);
  if (peer?.socket === socket) {
    bridgeBrokerState.peersByClientId.delete(clientId);
  }

  return clientId;
}

export async function removeSocket(socket: WebSocket, reason: string, context: RemoveSocketContext): Promise<void> {
  const targetClientId = bridgeBrokerState.clientIdBySocket.get(socket) ?? '';
  const targetPeer = targetClientId.length > 0 ? bridgeBrokerState.peersByClientId.get(targetClientId) : undefined;
  const clientRole: BridgeDisconnectEvent['clientRole'] = targetClientId.length === 0
    ? 'unknown'
    : (targetClientId === bridgeBrokerState.activeClientId ? 'active' : 'standby');
  const connectedDurationMs = targetPeer ? Math.max(0, nowMs() - targetPeer.connectedAt) : 0;

  const clientId = unbindSocket(socket);
  if (clientId.length === 0) {
    return;
  }

  if (clientId === bridgeBrokerState.activeClientId) {
    bridgeBrokerState.activeClientId = '';
    rejectPendingRequestsByClient(clientId, reason);
  }

  await electActivePeer(reason);

  bridgeBrokerState.disconnectEventHandler?.({
    eventId: createDisconnectEventId(clientId, context.disconnectType),
    clientId,
    clientRole,
    disconnectType: context.disconnectType,
    disconnectActor: context.disconnectActor,
    closeCode: Number.isInteger(context.closeCode) && Number(context.closeCode) > 0
      ? String(context.closeCode)
      : BRIDGE_BROKER_TEXT.connection.emptyFallback,
    closeReason: normalizeDisconnectText(context.closeReason),
    detail: normalizeDisconnectText(reason),
    leaseTerm: bridgeBrokerState.leaseTerm,
    connectedDurationMs,
    remainingClientCount: bridgeBrokerState.peersByClientId.size,
    occurredAt: new Date().toISOString(),
  });
}

export async function cleanupExpiredPeers(): Promise<void> {
  const current = nowMs();
  for (const peer of [...bridgeBrokerState.peersByClientId.values()]) {
    if (peer.socket.readyState !== WebSocket.OPEN) {
      await removeSocket(peer.socket, BRIDGE_BROKER_TEXT.connection.socketStateNotOpen, {
        disconnectType: 'socket_state_check',
        disconnectActor: 'runtime',
        closeReason: BRIDGE_BROKER_TEXT.connection.socketStateNotOpenReason,
      });
      continue;
    }

    if (current - peer.lastSeenAt > BRIDGE_CLIENT_TTL_MS) {
      await removeSocket(peer.socket, BRIDGE_BROKER_TEXT.connection.heartbeatTimeoutDetail, {
        disconnectType: 'heartbeat_timeout',
        disconnectActor: 'timeout',
        closeReason: BRIDGE_BROKER_TEXT.connection.heartbeatTimeoutReason,
      });
    }
  }
}

export async function registerClient(clientId: string, socket: WebSocket): Promise<BridgePeerState> {
  const normalizedClientId = String(clientId ?? '').trim();
  if (normalizedClientId.length === 0) {
    throw new Error(BRIDGE_BROKER_TEXT.connection.missingClientId);
  }

  const current = nowMs();
  const existingPeer = bridgeBrokerState.peersByClientId.get(normalizedClientId);
  const isExistingSocketBinding = Boolean(existingPeer && existingPeer.socket === socket);
  if (existingPeer && existingPeer.socket !== socket) {
    bridgeBrokerState.clientIdBySocket.delete(existingPeer.socket);
  }

  const peer: BridgePeerState = {
    clientId: normalizedClientId,
    connectedAt: existingPeer?.connectedAt ?? current,
    lastSeenAt: current,
    isReady: isExistingSocketBinding ? existingPeer?.isReady ?? false : false,
    socket,
  };
  bridgeBrokerState.peersByClientId.set(normalizedClientId, peer);
  bridgeBrokerState.clientIdBySocket.set(socket, normalizedClientId);

  const currentMs = Date.now();
  if (currentMs - bridgeBrokerState.lastCleanupAt > 2000) {
    bridgeBrokerState.lastCleanupAt = currentMs;
    await cleanupExpiredPeers();
  }

  if (!getActivePeer()) {
    bridgeBrokerState.activeClientId = normalizedClientId;
    bridgeBrokerState.leaseTerm += 1;
    resolveActiveWaiters();
    await broadcastRoles(BRIDGE_BROKER_TEXT.role.firstClientBecameActive);
  }
  else if (!isExistingSocketBinding) {
    await sendRoleToPeer(
      peer,
      peer.clientId === bridgeBrokerState.activeClientId
        ? BRIDGE_BROKER_TEXT.role.activeRoleConfirmed
        : BRIDGE_BROKER_TEXT.role.enterStandbyRole,
    );
  }

  return peer;
}

export async function waitForActivePeer(timeoutMs: number): Promise<void> {
  await cleanupExpiredPeers();
  if (getReadyActivePeer()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve: () => {
        resolve();
      },
      reject: (reason?: unknown) => {
        reject(reason);
      },
      timer: setTimeout(() => {
        bridgeBrokerState.pendingActiveWaiters.delete(waiter);
        reject(new BridgePeerWaitTimeoutError());
      }, timeoutMs),
    };

    bridgeBrokerState.pendingActiveWaiters.add(waiter);
    void cleanupExpiredPeers().then(() => {
      resolveActiveWaiters();
    });
  });
}

export function completePendingRequest(message: {
  clientId: string;
  requestId: string;
  leaseTerm: number;
  result?: unknown;
  error?: unknown;
}): void {
  const pending = bridgeBrokerState.pendingRequests.get(message.requestId);
  if (!pending) {
    return;
  }

  if (pending.clientId !== message.clientId || pending.leaseTerm !== message.leaseTerm) {
    return;
  }

  clearTimeout(pending.timer);
  bridgeBrokerState.pendingRequests.delete(message.requestId);
  if (message.error !== undefined && message.error !== null) {
    if (isBridgeProtocolError(message.error)) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.reject(new Error(String(message.error)));
    return;
  }

  pending.resolve(message.result);
}
