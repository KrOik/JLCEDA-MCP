import { enqueueBridgeRequest } from '../bridge/broker';
import { parseBoundedIntegerValue } from '../../utils';
import { DEFAULT_BRIDGE_TIMEOUT_MS } from './tool-dispatcher-types';

export async function handleApiIndex(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const owner = String(argumentsObject.owner ?? '').trim();
  return await enqueueBridgeRequest('/bridge/jlceda/api/index', { owner }, DEFAULT_BRIDGE_TIMEOUT_MS);
}

export async function handleApiSearch(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const query = String(argumentsObject.query ?? '').trim();
  if (query.length === 0) {
    throw new Error('api_search 缺少 query 参数。');
  }

  const scope = String(argumentsObject.scope ?? 'all').trim().toLowerCase();
  if (!['all', 'callable', 'type'].includes(scope)) {
    throw new Error('scope 仅支持 all/callable/type。');
  }

  const owner = String(argumentsObject.owner ?? '').trim();
  const limit = parseBoundedIntegerValue(argumentsObject.limit, 10, 1, 50);
  return await enqueueBridgeRequest('/bridge/jlceda/api/search', {
    query,
    scope,
    owner,
    limit,
  }, DEFAULT_BRIDGE_TIMEOUT_MS);
}

export async function handleApiInvoke(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const apiFullName = String(argumentsObject.apiFullName ?? '').trim();
  if (apiFullName.length === 0) {
    throw new Error('api_invoke 缺少 apiFullName 参数。');
  }

  const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
  const invokeArgs = Array.isArray(argumentsObject.args) ? argumentsObject.args : [];
  return await enqueueBridgeRequest('/bridge/jlceda/api/invoke', {
    apiFullName,
    args: invokeArgs,
  }, timeoutMs);
}

export async function handleEdaContext(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
  const scope = String(argumentsObject.scope ?? '').trim();
  return await enqueueBridgeRequest('/bridge/jlceda/context', { scope }, timeoutMs);
}

export async function handleSchematicRead(): Promise<unknown> {
  return await enqueueBridgeRequest('/bridge/jlceda/schematic/read', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
}

export async function handleSchematicReview(): Promise<unknown> {
  return await enqueueBridgeRequest('/bridge/jlceda/schematic/review', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
}
