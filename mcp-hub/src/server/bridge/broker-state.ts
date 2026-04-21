import type WebSocket from 'ws';
import { BridgeLogPipeline } from '../../logging/bridge-log';

export interface BridgePeerState {
  clientId: string;
  connectedAt: number;
  lastSeenAt: number;
  isReady: boolean;
  socket: WebSocket;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
  clientId: string;
  leaseTerm: number;
  path: string;
}

export interface PendingActiveWaiter {
  resolve: () => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export interface RemoveSocketContext {
  disconnectType: string;
  disconnectActor: 'client' | 'server' | 'timeout' | 'network' | 'runtime' | 'unknown';
  closeCode?: number;
  closeReason?: string;
}

export interface BridgeDisconnectEvent {
  eventId: string;
  clientId: string;
  clientRole: 'active' | 'standby' | 'unknown';
  disconnectType: string;
  disconnectActor: 'client' | 'server' | 'timeout' | 'network' | 'runtime' | 'unknown';
  closeCode: string;
  closeReason: string;
  detail: string;
  leaseTerm: number;
  connectedDurationMs: number;
  remainingClientCount: number;
  occurredAt: string;
}

export interface BridgeVersionMismatchEvent {
  bridgeVersion: string;
  serverVersion: string;
  lowerSide: 'bridge' | 'server';
}

export interface BridgeRequestTimeoutResult {
  timeout: true;
  timeoutType: 'wait_active_peer' | 'wait_result';
  timeoutReason: string;
  path: string;
  message: string;
  timeoutMs: number;
  elapsedMs: number;
}

interface BridgeBrokerState {
  requestSequence: number;
  disconnectSequence: number;
  leaseTerm: number;
  activeClientId: string;
  peersByClientId: Map<string, BridgePeerState>;
  clientIdBySocket: Map<WebSocket, string>;
  pendingRequests: Map<string, PendingRequest>;
  pendingActiveWaiters: Set<PendingActiveWaiter>;
  bridgeLogPipeline: BridgeLogPipeline;
  disconnectEventHandler?: (event: BridgeDisconnectEvent) => void;
  versionMismatchHandler?: (event: BridgeVersionMismatchEvent) => void;
  serverVersion: string;
  isServerShuttingDown: boolean;
  lastCleanupAt: number;
}

export const bridgeBrokerState: BridgeBrokerState = {
  requestSequence: 0,
  disconnectSequence: 0,
  leaseTerm: 0,
  activeClientId: '',
  peersByClientId: new Map<string, BridgePeerState>(),
  clientIdBySocket: new Map<WebSocket, string>(),
  pendingRequests: new Map<string, PendingRequest>(),
  pendingActiveWaiters: new Set<PendingActiveWaiter>(),
  bridgeLogPipeline: new BridgeLogPipeline(),
  disconnectEventHandler: undefined,
  versionMismatchHandler: undefined,
  serverVersion: '',
  isServerShuttingDown: false,
  lastCleanupAt: 0,
};
