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

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeIntegerArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter(item => typeof item === 'number' && Number.isInteger(item))
    .map(item => Number(item));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRecord(value: unknown): Record<string, boolean> | undefined {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([, current]) => typeof current === 'boolean'),
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export async function handlePcbSnapshot(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
  return await enqueueBridgeRequest('/bridge/jlceda/pcb/snapshot', {
    nets: normalizeStringArray(argumentsObject.nets),
    layerIds: normalizeIntegerArray(argumentsObject.layerIds),
    include: normalizeRecord(argumentsObject.include),
  }, timeoutMs);
}

export async function handlePcbGeometryAnalyze(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
  const sampleStep = parseBoundedIntegerValue(argumentsObject.sampleStep, 8, 1, 500);
  return await enqueueBridgeRequest('/bridge/jlceda/pcb/geometry/analyze', {
    nets: normalizeStringArray(argumentsObject.nets),
    layerIds: normalizeIntegerArray(argumentsObject.layerIds),
    include: normalizeRecord(argumentsObject.include),
    tracePrimitiveIds: normalizeStringArray(argumentsObject.tracePrimitiveIds),
    referenceNetNames: normalizeStringArray(argumentsObject.referenceNetNames),
    spatialObjectKinds: normalizeStringArray(argumentsObject.spatialObjectKinds),
    analysisModes: normalizeStringArray(argumentsObject.analysisModes),
    sampleStep,
    includeSnapshot: argumentsObject.includeSnapshot === true,
  }, timeoutMs);
}

export async function handlePcbConstraintSnapshot(argumentsObject: Record<string, unknown>): Promise<unknown> {
  const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
  return await enqueueBridgeRequest('/bridge/jlceda/pcb/constraint/snapshot', {
    nets: normalizeStringArray(argumentsObject.nets),
    viaPrimitiveIds: normalizeStringArray(argumentsObject.viaPrimitiveIds),
    padPrimitiveIds: normalizeStringArray(argumentsObject.padPrimitiveIds),
    include: normalizeRecord(argumentsObject.include),
  }, timeoutMs);
}

export async function handleSchematicRead(): Promise<unknown> {
  return await enqueueBridgeRequest('/bridge/jlceda/schematic/read', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
}

export async function handleSchematicReview(): Promise<unknown> {
  return await enqueueBridgeRequest('/bridge/jlceda/schematic/review', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
}
