import WebSocket, { type RawData } from 'ws';
import {
  type BridgeClientMessage,
  type BridgeDebugSwitch,
  type BridgeServerMessage,
  isBridgeClientMessageType,
} from './protocol';
import { DEBUG_SWITCH } from '../../debug';
import { ServerStateManager } from '../../state/server-state-manager';
import { isPlainObjectRecord } from '../../utils';
import type { BridgeRequestTimeoutResult } from './broker-state';

export const BRIDGE_CLIENT_TTL_MS = 8_000;
export const BRIDGE_BROKER_TEXT = ServerStateManager.text.broker;

export class BridgePeerWaitTimeoutError extends Error {
  public constructor() {
    super(BRIDGE_BROKER_TEXT.wait.peerNotReadyError);
    this.name = 'BridgePeerWaitTimeoutError';
  }
}

export function getBridgeDebugSwitch(): BridgeDebugSwitch {
  return {
    enableSystemLog: DEBUG_SWITCH.enableSystemLog,
    enableConnectionList: DEBUG_SWITCH.enableConnectionList,
  };
}

export function nowMs(): number {
  return Date.now();
}

export function createBridgeRequestTimeoutResult(
  path: string,
  timeoutType: 'wait_active_peer' | 'wait_result',
  timeoutMs: number,
  startedAt: number,
): BridgeRequestTimeoutResult {
  const timeoutReason = timeoutType === 'wait_active_peer'
    ? BRIDGE_BROKER_TEXT.wait.waitActivePeerTimeoutReason
    : BRIDGE_BROKER_TEXT.wait.waitResultTimeoutReason;
  const message = timeoutType === 'wait_active_peer'
    ? `${BRIDGE_BROKER_TEXT.wait.waitActivePeerTimeoutMessagePrefix}: ${path}`
    : `${BRIDGE_BROKER_TEXT.wait.waitResultTimeoutMessagePrefix}: ${path}`;

  return {
    timeout: true,
    timeoutType,
    timeoutReason,
    path,
    message,
    timeoutMs,
    elapsedMs: Math.max(0, nowMs() - startedAt),
  };
}

export function normalizeDisconnectText(
  value: unknown,
  fallback = BRIDGE_BROKER_TEXT.connection.emptyFallback,
): string {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
}

export function decodeCloseReason(reason: Buffer): string {
  return normalizeDisconnectText(reason.toString('utf8'), BRIDGE_BROKER_TEXT.connection.emptyFallback);
}

function decodeWebSocketData(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

export function parseClientMessage(data: RawData): BridgeClientMessage {
  const parsed = JSON.parse(decodeWebSocketData(data)) as unknown;
  if (!isPlainObjectRecord(parsed)) {
    throw new Error(BRIDGE_BROKER_TEXT.protocol.invalidMessageRoot);
  }

  const messageType = String(parsed.type ?? '').trim();
  if (messageType.length === 0) {
    throw new Error(BRIDGE_BROKER_TEXT.protocol.missingMessageType);
  }

  if (!isBridgeClientMessageType(messageType)) {
    throw new Error(`${BRIDGE_BROKER_TEXT.protocol.unknownClientMessageTypePrefix}: ${messageType}。`);
  }

  return parsed as unknown as BridgeClientMessage;
}

export function sendBridgeMessage(socket: WebSocket, message: BridgeServerMessage): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error(BRIDGE_BROKER_TEXT.connection.socketNotOpen));
      return;
    }

    socket.send(JSON.stringify(message), (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function sendBridgeError(
  socket: WebSocket,
  message: string,
  requestId?: string,
): Promise<void> {
  try {
    await sendBridgeMessage(socket, {
      type: 'bridge/error',
      message,
      requestId,
    });
  }
  catch {
    return;
  }
}

export function compareSemver(a: string, b: string): number {
  const parsePart = (value: string): number[] => value.split('.').map((item) => Number.parseInt(item, 10) || 0);
  const aParts = parsePart(a);
  const bParts = parsePart(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (aParts[index] ?? 0) - (bParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
