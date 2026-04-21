/**
 * ------------------------------------------------------------------------
 * 名称：桥接仲裁中心
 * 说明：维护客户端角色、租约、任务分发与结果回收。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：服务端仅裁决活动/待命角色，不主动踢掉待命连接。
 * ------------------------------------------------------------------------
 */

import type WebSocket from 'ws';
import { type RawData } from 'ws';
import type { UnifiedLogEntry } from '../../logging/server-log';
import { isUnifiedLogEntry } from '../../logging/server-log';
import {
  bridgeBrokerState,
  type BridgeDisconnectEvent as BrokerDisconnectEvent,
  type BridgeRequestTimeoutResult,
  type BridgeVersionMismatchEvent as BrokerVersionMismatchEvent,
} from './broker-state';
import {
  cleanupExpiredPeers,
  completePendingRequest,
  electActivePeer,
  getActivePeer,
  getReadyActivePeer,
  registerClient,
  removeSocket,
  resolveActiveWaiters,
  sendDebugSwitchToPeer,
  waitForActivePeer,
} from './broker-lifecycle';
import {
  BRIDGE_BROKER_TEXT,
  BridgePeerWaitTimeoutError,
  compareSemver,
  createBridgeRequestTimeoutResult,
  decodeCloseReason,
  getBridgeDebugSwitch,
  nowMs,
  parseClientMessage,
  sendBridgeError,
  sendBridgeMessage,
} from './broker-transport';

function createRequestId(): string {
  bridgeBrokerState.requestSequence += 1;
  return `bridge_req_${Date.now()}_${bridgeBrokerState.requestSequence}`;
}

function checkVersionMismatch(bridgeVersion: string): void {
  if (!bridgeBrokerState.serverVersion || !bridgeVersion || !bridgeBrokerState.versionMismatchHandler) {
    return;
  }

  const compareResult = compareSemver(bridgeVersion, bridgeBrokerState.serverVersion);
  if (compareResult === 0) {
    return;
  }

  bridgeBrokerState.versionMismatchHandler({
    bridgeVersion,
    serverVersion: bridgeBrokerState.serverVersion,
    lowerSide: compareResult < 0 ? 'bridge' : 'server',
  });
}

async function handleClientMessage(socket: WebSocket, data: RawData): Promise<void> {
  const message = parseClientMessage(data);
  if (message.type === 'bridge/hello') {
    const peer = await registerClient(message.clientId, socket);
    const bridgeVersion = String(message.bridgeVersion ?? '').trim();
    checkVersionMismatch(bridgeVersion.length > 0 ? bridgeVersion : BRIDGE_BROKER_TEXT.version.legacyClientWithoutVersion);
    await sendBridgeMessage(peer.socket, {
      type: 'bridge/welcome',
      clientId: peer.clientId,
      connectedAt: new Date(peer.connectedAt).toISOString(),
    });
    await sendDebugSwitchToPeer(peer);
    return;
  }

  if (message.type === 'bridge/heartbeat') {
    const peer = await registerClient(message.clientId, socket);
    peer.lastSeenAt = nowMs();
    await sendBridgeMessage(peer.socket, {
      type: 'bridge/heartbeat-ack',
      clientId: peer.clientId,
      sentAt: message.sentAt,
      receivedAt: new Date(peer.lastSeenAt).toISOString(),
    });
    return;
  }

  if (message.type === 'bridge/result') {
    const peer = await registerClient(message.clientId, socket);
    peer.lastSeenAt = nowMs();
    completePendingRequest({
      clientId: peer.clientId,
      requestId: String(message.requestId ?? '').trim(),
      leaseTerm: Number(message.leaseTerm ?? 0),
      result: message.result,
      error: message.error,
    });
    return;
  }

  if (message.type === 'bridge/ready') {
    const peer = await registerClient(message.clientId, socket);
    peer.lastSeenAt = nowMs();
    peer.isReady = true;
    resolveActiveWaiters();
    return;
  }

  if (message.type === 'bridge/log') {
    const peer = await registerClient(message.clientId, socket);
    peer.lastSeenAt = nowMs();
    if (!isUnifiedLogEntry(message.log)) {
      throw new Error(BRIDGE_BROKER_TEXT.protocol.invalidClientLogEntry);
    }

    bridgeBrokerState.bridgeLogPipeline.appendFromClient(message.log, getBridgeDebugSwitch());
    return;
  }

  throw new Error(BRIDGE_BROKER_TEXT.protocol.unsupportedBridgeMessageType);
}

export function setServerVersion(version: string): void {
  bridgeBrokerState.serverVersion = String(version ?? '').trim();
}

export function setVersionMismatchHandler(
  handler: ((event: BrokerVersionMismatchEvent) => void) | undefined,
): void {
  bridgeBrokerState.versionMismatchHandler = handler;
}

export function setBridgeDisconnectHandler(
  handler: ((event: BrokerDisconnectEvent) => void) | undefined,
): void {
  bridgeBrokerState.disconnectEventHandler = handler;
}

export function attachBridgeClientSocket(socket: WebSocket): void {
  socket.on('message', (data: RawData) => {
    void handleClientMessage(socket, data).catch(async (error: unknown) => {
      await sendBridgeError(socket, error instanceof Error ? error.message : String(error));
    });
  });

  socket.on('close', (code: number, reason: Buffer) => {
    const closeReason = decodeCloseReason(reason);
    void removeSocket(socket, BRIDGE_BROKER_TEXT.connection.clientConnectionClosed, {
      disconnectType: bridgeBrokerState.isServerShuttingDown ? 'server_shutdown' : 'client_close',
      disconnectActor: bridgeBrokerState.isServerShuttingDown ? 'server' : 'client',
      closeCode: code,
      closeReason,
    });
  });

  socket.on('error', () => {
    void removeSocket(socket, BRIDGE_BROKER_TEXT.connection.clientConnectionInterrupted, {
      disconnectType: 'socket_error',
      disconnectActor: 'network',
      closeReason: 'socket_error',
    });
  });
}

export async function enqueueBridgeRequest(
  path: string,
  payload: unknown,
  timeoutMs: number,
): Promise<unknown | BridgeRequestTimeoutResult> {
  const startedAt = nowMs();
  const deadlineAt = startedAt + timeoutMs;
  while (true) {
    const waitTimeout = deadlineAt - nowMs();
    if (waitTimeout <= 0) {
      return createBridgeRequestTimeoutResult(path, 'wait_active_peer', timeoutMs, startedAt);
    }

    try {
      await waitForActivePeer(waitTimeout);
    }
    catch (error: unknown) {
      if (error instanceof BridgePeerWaitTimeoutError) {
        return createBridgeRequestTimeoutResult(path, 'wait_active_peer', timeoutMs, startedAt);
      }
      throw error;
    }

    const activePeer = getActivePeer();
    const readyActivePeer = getReadyActivePeer();
    if (!readyActivePeer || !activePeer) {
      continue;
    }

    const currentLeaseTerm = bridgeBrokerState.leaseTerm;
    const requestId = createRequestId();
    const request = {
      requestId,
      path,
      payload,
      createdAt: nowMs(),
      leaseTerm: currentLeaseTerm,
    };

    const resultPromise = new Promise<unknown | BridgeRequestTimeoutResult>((resolve, reject) => {
      const remaining = deadlineAt - nowMs();
      const timer = setTimeout(() => {
        bridgeBrokerState.pendingRequests.delete(requestId);
        resolve(createBridgeRequestTimeoutResult(path, 'wait_result', timeoutMs, startedAt));
      }, remaining);

      bridgeBrokerState.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        clientId: readyActivePeer.clientId,
        leaseTerm: currentLeaseTerm,
        path,
      });
    });

    try {
      await sendBridgeMessage(readyActivePeer.socket, {
        type: 'bridge/task',
        ...request,
      });
    }
    catch {
      const pending = bridgeBrokerState.pendingRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        bridgeBrokerState.pendingRequests.delete(requestId);
      }
      await removeSocket(readyActivePeer.socket, BRIDGE_BROKER_TEXT.connection.taskSendFailure, {
        disconnectType: 'send_failure',
        disconnectActor: 'runtime',
        closeReason: 'bridge_task_send_failed',
      });
      continue;
    }

    return await resultPromise;
  }
}

export function getBridgeStatus(): { connectedClients: number; pendingRequests: number; clientIds: string[] } {
  const clientIds = [...bridgeBrokerState.peersByClientId.keys()].sort((left, right) => left.localeCompare(right));
  if (bridgeBrokerState.activeClientId.length > 0) {
    const index = clientIds.indexOf(bridgeBrokerState.activeClientId);
    if (index > 0) {
      clientIds.splice(index, 1);
      clientIds.unshift(bridgeBrokerState.activeClientId);
    }
  }

  return {
    connectedClients: clientIds.length,
    pendingRequests: bridgeBrokerState.pendingRequests.size,
    clientIds,
  };
}

export function flushBridgeLogs(): UnifiedLogEntry[] {
  return bridgeBrokerState.bridgeLogPipeline.flush();
}

export async function pumpBridgeBroker(): Promise<void> {
  await cleanupExpiredPeers();
  await electActivePeer(BRIDGE_BROKER_TEXT.role.autoTakeoverAfterActiveOffline);
}

export async function notifyBridgeClientsDisconnect(message: string): Promise<void> {
  bridgeBrokerState.isServerShuttingDown = true;
  const tasks: Array<Promise<void>> = [];
  for (const peer of bridgeBrokerState.peersByClientId.values()) {
    tasks.push(sendBridgeMessage(peer.socket, {
      type: 'bridge/error',
      message,
    }));
  }
  await Promise.allSettled(tasks);
}

export async function waitForBridgeReady(timeoutMs: number): Promise<void> {
  try {
    await waitForActivePeer(timeoutMs);
  }
  catch (error: unknown) {
    if (error instanceof BridgePeerWaitTimeoutError) {
      throw new Error(BRIDGE_BROKER_TEXT.wait.buildBridgeReadyTimeoutMessage(timeoutMs));
    }
    throw error;
  }
}

export type {
  BridgeDisconnectEvent,
  BridgeRequestTimeoutResult,
  BridgeVersionMismatchEvent,
} from './broker-state';
