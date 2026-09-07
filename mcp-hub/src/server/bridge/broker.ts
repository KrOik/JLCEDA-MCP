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
import { bridgeRequestContext } from './request-context';
import { sendRoleToPeer } from './broker-lifecycle';
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
    if (message.context && typeof message.context.documentUuid === 'string'
      && typeof message.context.documentType === 'string' && typeof message.context.title === 'string') {
      peer.context = message.context;
    }
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
    peer.lastExecution = { requestId: message.requestId, state: message.error ? 'failed' : 'completed', completedAt: nowMs(),
      result: JSON.stringify(message.result ?? null).length <= 20000 ? message.result : { omitted: true, message: '结果过大，请使用图元查询工具回读' }, error: message.error };
    if (peer.uncertainRequestId === message.requestId) peer.uncertainRequestId = undefined;
    const pending = bridgeBrokerState.pendingRequests.get(message.requestId);
    if (pending?.path === '/bridge/jlceda/schematic/place-rows' && peer.context && message.result && typeof message.result === 'object') {
      const job = message.result as { jobId?: string; state?: string; pending?: string };
      if (job.jobId && job.state) peer.context.backgroundJob = ['running', 'uncertain'].includes(job.state) ? { jobId: job.jobId, state: job.state, pending: job.pending } : undefined;
    }
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
	// Native websocket pong does not depend on the EDA page's throttled JS timer.
	socket.on('pong', () => {
		const clientId = bridgeBrokerState.clientIdBySocket.get(socket);
		const peer = clientId ? bridgeBrokerState.peersByClientId.get(clientId) : undefined;
		if (peer?.socket === socket) peer.lastPongAt = nowMs();
	});
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

let dispatching = false;

/**
 * Omitted routing is safe only when every live peer reports exactly the same
 * editable document. This covers duplicate extension frames for one EDA tab
 * without letting a second schematic/PCB window receive an accidental write.
 */
function inferUnambiguousPeer(peers: Array<{ clientId: string; isReady: boolean; context?: { documentUuid: string; documentType: string } }>) {
  if (peers.length < 2 || !peers.every(peer => peer.isReady && peer.context?.documentUuid)) {
    return undefined;
  }
  const documents = new Set(peers.map(peer => `${peer.context?.documentType}\u0000${peer.context?.documentUuid}`));
  if (documents.size !== 1) {
    return undefined;
  }
  const active = getReadyActivePeer();
  return active && peers.some(peer => peer.clientId === active.clientId) ? active : undefined;
}

function hasConflictingDocumentContexts(peers: Array<{ context?: { documentUuid: string; documentType: string } }>): boolean {
  const documents = new Set(peers
    .filter(peer => peer.context?.documentUuid)
    .map(peer => `${peer.context?.documentType}\u0000${peer.context?.documentUuid}`));
  return documents.size > 1;
}

export async function enqueueBridgeRequest(path: string, payload: unknown, timeoutMs: number): Promise<unknown> {
  if (dispatching) return { ok: false, errorCode: 'BRIDGE_BUSY', message: '另一个客户端任务正在执行，请稍后重试；未排队、未执行。' };
  dispatching = true;
  try {
    const target = bridgeRequestContext.getStore();
    const peers = [...bridgeBrokerState.peersByClientId.values()];
    if (!peers.length) {
      return { ok: false, errorCode: 'BRIDGE_OFFLINE', message: '没有 EDA 页面连接，未执行。请打开目标页面并检查 bridge_status。' };
    }
    const inferredPeer = !target?.targetClientId ? inferUnambiguousPeer(peers) : undefined;
    if (peers.length > 1 && !target?.targetClientId && !inferredPeer) {
      if (hasConflictingDocumentContexts(peers)) {
        return { ok: false, errorCode: 'PAGE_CHANGE_DECLARATION_REQUIRED',
          message: '检测到窗口/页面已切换。请先显式声明目标 targetClientId 和 targetDocumentUuid；未执行。', ...getBridgeStatus() };
      }
      return { ok: false, errorCode: 'TARGET_REQUIRED', message: '多个 EDA 页面在线，先调用 bridge_status，再指定 targetClientId 和 targetDocumentUuid。', ...getBridgeStatus() };
    }
    const peer = target?.targetClientId ? bridgeBrokerState.peersByClientId.get(target.targetClientId) : inferredPeer ?? peers[0];
    if (target?.targetClientId && !peer) return { ok: false, errorCode: 'TARGET_OFFLINE' };
    const owner = peers.find(p => p.context?.backgroundJob);
    if (owner && (owner !== peer || !['/bridge/jlceda/schematic/place-rows', '/bridge/jlceda/context'].includes(path))) {
      return { ok: false, errorCode: 'ROWS_JOB_OWNS_WRITES', jobId: owner.context!.backgroundJob!.jobId, targetClientId: owner.clientId, message: '后台排版任务持有写入权；先查询 schematic_place_rows status，不能切换客户端绕过。' };
    }
    if (peer && !peer.isReady) return { ok: false, errorCode: 'TARGET_NOT_READY', message: '目标页面尚未完成握手，未执行。' };
    const needsDocument = /\/jlceda\/(pcb\/|schematic\/|component\/place|component\/match)/.test(path);
    if (peer && needsDocument && !peer.context?.documentUuid) return { ok: false, errorCode: 'CONTEXT_NOT_READY', message: '等待页面心跳上报 documentUuid 后重试，未执行。' };
    if (peer?.context && needsDocument) {
      const expectedType = path.includes('/pcb/') ? 'pcb' : path.includes('/component/match') ? undefined : 'schematic';
      if (expectedType && peer.context.documentType !== expectedType) return { ok: false, errorCode: 'DOCUMENT_TYPE_MISMATCH', context: peer.context };
    }
    if (peer?.uncertainRequestId) return { ok: false, errorCode: 'EXECUTION_UNCERTAIN', requestId: peer.uncertainRequestId,
      message: '上次执行已超时但可能仍在 EDA 中运行，暂停此连接的新任务，等待原调用结束。不要重复放置。' };
    if (peer && target?.targetDocumentUuid && peer.context?.documentUuid !== target.targetDocumentUuid) {
      return { ok: false, errorCode: 'DOCUMENT_CHANGED', context: peer.context };
    }
    if (peer && peer.clientId !== bridgeBrokerState.activeClientId) {
      bridgeBrokerState.activeClientId = peer.clientId;
      bridgeBrokerState.leaseTerm += 1;
      await Promise.all([...bridgeBrokerState.peersByClientId.values()].map(item => sendRoleToPeer(item, 'Explicit per-request target')));
    }
    return await dispatchBridgeRequest(path, payload, timeoutMs);
  } finally { dispatching = false; }
}

async function dispatchBridgeRequest(
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
    readyActivePeer.lastExecution = { requestId, state: 'executing' };
    const request = {
      deadlineAt,
      targetDocumentUuid: bridgeRequestContext.getStore()?.targetDocumentUuid ?? readyActivePeer.context?.documentUuid,
      requestId,
      path,
      payload,
      createdAt: nowMs(),
      leaseTerm: currentLeaseTerm,
    };

    const resultPromise = new Promise<unknown | BridgeRequestTimeoutResult>((resolve, reject) => {
      const remaining = deadlineAt - nowMs();
      const timer = setTimeout(() => {
        readyActivePeer.uncertainRequestId = requestId;
        readyActivePeer.lastExecution = { requestId, state: 'unknown' };
        bridgeBrokerState.pendingRequests.delete(requestId);
        resolve({ ...createBridgeRequestTimeoutResult(path, 'wait_result', timeoutMs, startedAt), requestId,
          executionState: 'unknown', retrySafe: false });
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
      return { ok: false, errorCode: 'SEND_FAILED', executionState: 'unknown', retrySafe: false, requestId };
    }

    return await resultPromise;
  }
}

export function getBridgeStatus() {
  const clientIds = [...bridgeBrokerState.peersByClientId.keys()].sort((left, right) => left.localeCompare(right));
  if (bridgeBrokerState.activeClientId.length > 0) {
    const index = clientIds.indexOf(bridgeBrokerState.activeClientId);
    if (index > 0) {
      clientIds.splice(index, 1);
      clientIds.unshift(bridgeBrokerState.activeClientId);
    }
  }

  return {
    clients: [...bridgeBrokerState.peersByClientId.values()].map(peer => ({
      clientId: peer.clientId, context: peer.context, ready: peer.isReady,
      lastSeenAt: peer.lastSeenAt, uncertainRequestId: peer.uncertainRequestId,
      lastExecution: peer.lastExecution,
      active: peer.clientId === bridgeBrokerState.activeClientId,
    })),
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
