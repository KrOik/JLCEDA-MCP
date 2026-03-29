/**
 * ------------------------------------------------------------------------
 * 名称：侧边栏交互状态文件
 * 说明：负责定义器件选型/放置交互协议，并提供宿主与运行时共享的状态文件读写能力。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-24
 * 备注：用于 VS Code 扩展宿主与 stdio 运行时之间的轻量交互通道。
 * ------------------------------------------------------------------------
 */

import * as fs from 'fs';
import * as path from 'path';
import { isPlainObjectRecord } from '../utils';

const SIDEBAR_INTERACTION_REQUEST_FILE_PREFIX = 'jlceda-mcp-sidebar-interaction-request';
const SIDEBAR_INTERACTION_RESPONSE_FILE_PREFIX = 'jlceda-mcp-sidebar-interaction-response';

export interface SidebarComponentSelectCandidate {
  uuid: string;
  libraryUuid: string;
  name: string;
  symbolName: string;
  footprintName: string;
  description: string;
  manufacturer: string;
  manufacturerId: string;
  supplier: string;
  supplierId: string;
  lcscInventory: number;
  lcscPrice: number;
}

export interface SidebarComponentPlaceItem {
  uuid: string;
  libraryUuid: string;
  name: string;
  footprintName: string;
  subPartName: string;
}

export interface SidebarComponentPlaceRowState {
  title: string;
  detail: string;
  status: 'pending' | 'active' | 'success' | 'timeout' | 'error' | 'skipped';
  statusText: string;
}

export interface SidebarComponentSelectInteraction {
  kind: 'component-select';
  requestId: string;
  keyword: string;
  title: string;
  description: string;
  noticeText: string;
  candidates: SidebarComponentSelectCandidate[];
  pageSize: number;
  currentPage: number;
}

export interface SidebarComponentPlaceInteraction {
  kind: 'component-place';
  requestId: string;
  title: string;
  description: string;
  noticeText: string;
  totalCount: number;
  placedCount: number;
  statusText: string;
  timeoutSeconds: number;
  retryCount: number;
  started: boolean;
  canStart: boolean;
  canCancel: boolean;
  rows: SidebarComponentPlaceRowState[];
}

export interface SidebarWirePlanConnectionRow {
  index: number;
  fromLabel: string;
  toLabel: string;
  netName: string;
}

export interface SidebarWirePlanInteraction {
  kind: 'wire-plan';
  requestId: string;
  title: string;
  description: string;
  noticeText: string;
  connectionMethod: 'wire' | 'net-label';
  connections: SidebarWirePlanConnectionRow[];
  canConfirm: boolean;
  canCancel: boolean;
}

export interface SidebarNetFlagWaitInteraction {
  kind: 'net-flag-wait';
  requestId: string;
  title: string;
  description: string;
  noticeText: string;
  missingSymbols: string[];
  canConfirm: boolean;
  canCancel: boolean;
}

export type SidebarInteractionRequest = SidebarComponentSelectInteraction | SidebarComponentPlaceInteraction | SidebarWirePlanInteraction | SidebarNetFlagWaitInteraction;

export type SidebarInteractionResponse =
  | { requestId: string; action: 'cancel' }
  | { requestId: string; action: 'start-placement' }
  | { requestId: string; action: 'change-page'; page: number }
  | { requestId: string; action: 'confirm-selection'; candidate: SidebarComponentSelectCandidate }
  | { requestId: string; action: 'confirm-wire-plan'; connectionMethod: 'wire' | 'net-label' }
  | { requestId: string; action: 'confirm-net-flag-placed' };

function sanitizeFileSegment(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default';
}

function getInteractionFilePath(storageDirectoryPath: string, sessionId: string, prefix: string): string {
  const fileName = `${prefix}-${sanitizeFileSegment(sessionId)}.json`;
  return path.join(storageDirectoryPath, fileName);
}

function isSidebarComponentSelectCandidate(value: unknown): value is SidebarComponentSelectCandidate {
  if (!isPlainObjectRecord(value)) {
    return false;
  }

  return typeof value.uuid === 'string'
    && typeof value.libraryUuid === 'string'
    && typeof value.name === 'string'
    && typeof value.symbolName === 'string'
    && typeof value.footprintName === 'string'
    && typeof value.description === 'string'
    && typeof value.manufacturer === 'string'
    && typeof value.manufacturerId === 'string'
    && typeof value.supplier === 'string'
    && typeof value.supplierId === 'string'
    && typeof value.lcscInventory === 'number'
    && Number.isFinite(value.lcscInventory)
    && typeof value.lcscPrice === 'number'
    && Number.isFinite(value.lcscPrice);
}

function isSidebarComponentPlaceRowState(value: unknown): value is SidebarComponentPlaceRowState {
  if (!isPlainObjectRecord(value)) {
    return false;
  }

  return typeof value.title === 'string'
    && typeof value.detail === 'string'
    && typeof value.status === 'string'
    && ['pending', 'active', 'success', 'timeout', 'error'].includes(value.status)
    && typeof value.statusText === 'string';
}

function isSidebarInteractionRequest(value: unknown): value is SidebarInteractionRequest {
  if (!isPlainObjectRecord(value) || typeof value.kind !== 'string' || typeof value.requestId !== 'string') {
    return false;
  }

  if (value.kind === 'component-select') {
    return typeof value.keyword === 'string'
      && typeof value.title === 'string'
      && typeof value.description === 'string'
      && typeof value.noticeText === 'string'
      && Array.isArray(value.candidates)
      && value.candidates.every((item) => isSidebarComponentSelectCandidate(item))
      && Number.isInteger(value.pageSize)
      && Number(value.pageSize) > 0
      && Number.isInteger(value.currentPage)
      && Number(value.currentPage) > 0;
  }

  if (value.kind === 'component-place') {
    return typeof value.title === 'string'
      && typeof value.description === 'string'
      && typeof value.noticeText === 'string'
      && Number.isInteger(value.totalCount)
      && Number(value.totalCount) >= 0
      && Number.isInteger(value.placedCount)
      && Number(value.placedCount) >= 0
      && typeof value.statusText === 'string'
      && Number.isInteger(value.timeoutSeconds)
      && Number(value.timeoutSeconds) > 0
      && Number.isInteger(value.retryCount)
      && Number(value.retryCount) >= 0
      && typeof value.started === 'boolean'
      && typeof value.canStart === 'boolean'
      && typeof value.canCancel === 'boolean'
      && Array.isArray(value.rows)
      && value.rows.every((item) => isSidebarComponentPlaceRowState(item));
  }

  if (value.kind === 'wire-plan') {
    return typeof value.title === 'string'
      && typeof value.description === 'string'
      && typeof value.noticeText === 'string'
      && (value.connectionMethod === 'wire' || value.connectionMethod === 'net-label')
      && Array.isArray(value.connections)
      && typeof value.canConfirm === 'boolean'
      && typeof value.canCancel === 'boolean';
  }

  if (value.kind === 'net-flag-wait') {
    return typeof value.title === 'string'
      && typeof value.description === 'string'
      && typeof value.noticeText === 'string'
      && Array.isArray(value.missingSymbols)
      && typeof value.canConfirm === 'boolean'
      && typeof value.canCancel === 'boolean';
  }

  return false;
}

function isSidebarInteractionResponse(value: unknown): value is SidebarInteractionResponse {
  if (!isPlainObjectRecord(value) || typeof value.requestId !== 'string' || typeof value.action !== 'string') {
    return false;
  }

  if (value.action === 'cancel' || value.action === 'start-placement' || value.action === 'confirm-net-flag-placed') {
    return true;
  }

  if (value.action === 'change-page') {
    return Number.isInteger(value.page) && Number(value.page) > 0;
  }

  if (value.action === 'confirm-selection') {
    return isSidebarComponentSelectCandidate(value.candidate);
  }

  if (value.action === 'confirm-wire-plan') {
    return value.connectionMethod === 'wire' || value.connectionMethod === 'net-label';
  }

  return false;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  }
  catch {
    return undefined;
  }
}

export function getSidebarInteractionRequestFilePath(storageDirectoryPath: string, sessionId: string): string {
  return getInteractionFilePath(storageDirectoryPath, sessionId, SIDEBAR_INTERACTION_REQUEST_FILE_PREFIX);
}

export function getSidebarInteractionResponseFilePath(storageDirectoryPath: string, sessionId: string): string {
  return getInteractionFilePath(storageDirectoryPath, sessionId, SIDEBAR_INTERACTION_RESPONSE_FILE_PREFIX);
}

export function writeSidebarInteractionRequest(storageDirectoryPath: string, sessionId: string, request: SidebarInteractionRequest): void {
  writeJsonFile(getSidebarInteractionRequestFilePath(storageDirectoryPath, sessionId), request);
}

export function readSidebarInteractionRequest(storageDirectoryPath: string, sessionId: string): SidebarInteractionRequest | undefined {
  const parsed = readJsonFile(getSidebarInteractionRequestFilePath(storageDirectoryPath, sessionId));
  return isSidebarInteractionRequest(parsed) ? parsed : undefined;
}

export function clearSidebarInteractionRequest(storageDirectoryPath: string, sessionId: string): void {
  fs.rmSync(getSidebarInteractionRequestFilePath(storageDirectoryPath, sessionId), { force: true });
}

export function writeSidebarInteractionResponse(storageDirectoryPath: string, sessionId: string, response: SidebarInteractionResponse): void {
  writeJsonFile(getSidebarInteractionResponseFilePath(storageDirectoryPath, sessionId), response);
}

export function readSidebarInteractionResponse(storageDirectoryPath: string, sessionId: string): SidebarInteractionResponse | undefined {
  const parsed = readJsonFile(getSidebarInteractionResponseFilePath(storageDirectoryPath, sessionId));
  return isSidebarInteractionResponse(parsed) ? parsed : undefined;
}

export function clearSidebarInteractionResponse(storageDirectoryPath: string, sessionId: string): void {
  fs.rmSync(getSidebarInteractionResponseFilePath(storageDirectoryPath, sessionId), { force: true });
}