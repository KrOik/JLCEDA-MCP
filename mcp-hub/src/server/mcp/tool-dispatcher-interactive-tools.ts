import { enqueueBridgeRequest } from '../bridge/broker';
import {
  type SidebarComponentPlaceInteraction,
  type SidebarComponentPlaceItem,
  type SidebarComponentPlaceRowState,
  type SidebarComponentSelectCandidate,
  type SidebarComponentSelectInteraction,
  type SidebarInteractionRequest,
  type SidebarInteractionResponse,
} from '../../state/sidebar-interaction';
import { isPlainObjectRecord, parseBoundedIntegerValue, toSafeErrorMessage } from '../../utils';
import {
  COMPONENT_PLACE_CHECK_INTERVAL_MS,
  DEFAULT_BRIDGE_TIMEOUT_MS,
  SIDEBAR_INTERACTION_TIMEOUT_MS,
  type ToolDispatcherInteractionChannel,
} from './tool-dispatcher-types';

const NET_FLAG_KEYWORDS = new Set([
  'vcc', 'gnd', 'ground', 'power', 'vdd', 'vss',
  '电源', '地', '电源符号', '地符号', 'vcc符号', 'gnd符号',
  'power symbol', 'ground symbol',
]);

interface ComponentSelectBridgePayload {
  title: string;
  description: string;
  candidates: SidebarComponentSelectCandidate[];
  pageSize: number;
  currentPage: number;
}

interface ComponentPlaceBridgePayload {
  title: string;
  description: string;
  components: SidebarComponentPlaceItem[];
  timeoutSeconds: number;
  retryCount: number;
}

interface ComponentPlaceStartResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

interface ComponentPlaceCheckResult {
  ok: boolean;
  placed?: boolean;
  userCancelled?: boolean;
  error?: string;
}

export interface InteractiveToolFlowDependencies {
  interactionChannel: ToolDispatcherInteractionChannel;
  skippedSelectKeywords: Set<string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createInteractionRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatPlaceComponentTitle(component: SidebarComponentPlaceItem): string {
  if (component.name.length > 0) {
    return component.name;
  }

  return `${component.libraryUuid}/${component.uuid}`;
}

function formatPlaceComponentDetail(component: SidebarComponentPlaceItem): string {
  const details: string[] = [];
  if (component.footprintName.length > 0) {
    details.push(`封装：${component.footprintName}`);
  }
  if (component.subPartName.length > 0) {
    details.push(`子部件：${component.subPartName}`);
  }
  if (details.length < 1) {
    details.push(`UUID：${component.uuid}`);
  }
  return details.join('  ');
}

function createInitialPlaceRows(components: SidebarComponentPlaceItem[]): SidebarComponentPlaceRowState[] {
  return components.map((component, index) => ({
    title: `${String(index + 1)}. ${formatPlaceComponentTitle(component)}`,
    detail: formatPlaceComponentDetail(component),
    status: 'pending',
    statusText: '待开始',
  }));
}

function writeInteractionRequest(
  interactionChannel: ToolDispatcherInteractionChannel,
  request: SidebarInteractionRequest | null,
): void {
  interactionChannel.publish(request);
}

async function waitForInteractionResponse(
  interactionChannel: ToolDispatcherInteractionChannel,
  requestId: string,
  acceptedActions: SidebarInteractionResponse['action'][],
): Promise<SidebarInteractionResponse> {
  return await interactionChannel.waitForResponse(requestId, acceptedActions, SIDEBAR_INTERACTION_TIMEOUT_MS);
}

function tryConsumeInteractionCancel(
  interactionChannel: ToolDispatcherInteractionChannel,
  requestId: string,
): boolean {
  const response = interactionChannel.tryConsumeResponse(requestId, ['cancel']);
  return response?.action === 'cancel';
}

function parseComponentSelectBridgePayload(result: unknown): ComponentSelectBridgePayload | null {
  if (!isPlainObjectRecord(result) || result.ok !== true || !isPlainObjectRecord(result.selection)) {
    return null;
  }

  const selection = result.selection;
  if (!Array.isArray(selection.candidates)) {
    return null;
  }

  const candidates = selection.candidates.filter((candidate): candidate is SidebarComponentSelectCandidate => {
    return isPlainObjectRecord(candidate)
      && typeof candidate.uuid === 'string'
      && typeof candidate.libraryUuid === 'string'
      && typeof candidate.name === 'string'
      && typeof candidate.symbolName === 'string'
      && typeof candidate.footprintName === 'string'
      && typeof candidate.description === 'string'
      && typeof candidate.manufacturer === 'string'
      && typeof candidate.manufacturerId === 'string'
      && typeof candidate.supplier === 'string'
      && typeof candidate.supplierId === 'string'
      && typeof candidate.lcscInventory === 'number'
      && typeof candidate.lcscPrice === 'number';
  });
  if (candidates.length < 1) {
    return null;
  }

  const pageSize = Number(selection.pageSize ?? 0);
  const currentPage = Number(selection.currentPage ?? 0);
  if (!Number.isInteger(pageSize) || pageSize < 1 || !Number.isInteger(currentPage) || currentPage < 1) {
    return null;
  }

  return {
    title: String(selection.title ?? '').trim() || '器件选型',
    description: String(selection.description ?? '').trim(),
    candidates,
    pageSize,
    currentPage,
  };
}

function parseComponentPlaceBridgePayload(result: unknown): ComponentPlaceBridgePayload | null {
  if (!isPlainObjectRecord(result) || result.ok !== true || !isPlainObjectRecord(result.placement)) {
    return null;
  }

  const placement = result.placement;
  if (!Array.isArray(placement.components)) {
    return null;
  }

  const components = placement.components.filter((component): component is SidebarComponentPlaceItem => {
    return isPlainObjectRecord(component)
      && typeof component.uuid === 'string'
      && typeof component.libraryUuid === 'string'
      && typeof component.name === 'string'
      && typeof component.footprintName === 'string'
      && typeof component.subPartName === 'string';
  });
  if (components.length < 1) {
    return null;
  }

  const timeoutSeconds = Number(placement.timeoutSeconds ?? 0);
  const retryCount = Number(placement.retryCount ?? 0);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || !Number.isInteger(retryCount) || retryCount < 0) {
    return null;
  }

  return {
    title: String(placement.title ?? '').trim() || '原理图器件放置',
    description: String(placement.description ?? '').trim(),
    components,
    timeoutSeconds,
    retryCount,
  };
}

async function fetchComponentSelectPage(keyword: string, limit: number, page: number): Promise<ComponentSelectBridgePayload> {
  const result = await enqueueBridgeRequest('/bridge/jlceda/component/select', {
    keyword,
    limit,
    page,
  }, DEFAULT_BRIDGE_TIMEOUT_MS);
  const payload = parseComponentSelectBridgePayload(result);
  if (!payload) {
    throw new Error('器件选型分页结果格式非法。');
  }

  return payload;
}

async function startComponentPlaceAttempt(
  component: SidebarComponentPlaceItem,
  timeoutSeconds: number,
): Promise<ComponentPlaceStartResult> {
  const result = await enqueueBridgeRequest('/bridge/jlceda/component/place/start', {
    component,
    timeoutSeconds,
  }, DEFAULT_BRIDGE_TIMEOUT_MS);
  if (!isPlainObjectRecord(result) || typeof result.ok !== 'boolean') {
    const isTimeout = isPlainObjectRecord(result) && result.timeout === true;
    return {
      ok: false,
      error: isTimeout
        ? `器件放置启动超时（桥接响应超过 ${String(DEFAULT_BRIDGE_TIMEOUT_MS / 1000)} 秒），请检查 EDA 桥接连接是否正常。`
        : '器件放置启动结果格式非法，请确认 EDA 桥接版本与当前 MCP 服务端版本匹配。',
    };
  }

  return {
    ok: result.ok,
    sessionId: typeof result.sessionId === 'string' ? result.sessionId : undefined,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

async function checkComponentPlaceAttempt(sessionId: string): Promise<ComponentPlaceCheckResult> {
  const result = await enqueueBridgeRequest('/bridge/jlceda/component/place/check', {
    sessionId,
  }, DEFAULT_BRIDGE_TIMEOUT_MS);
  if (!isPlainObjectRecord(result) || typeof result.ok !== 'boolean') {
    throw new Error('器件放置轮询结果格式非法。');
  }

  return {
    ok: result.ok,
    placed: typeof result.placed === 'boolean' ? result.placed : undefined,
    userCancelled: typeof result.userCancelled === 'boolean' ? result.userCancelled : undefined,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

async function closeComponentPlaceAttempt(sessionId: string): Promise<void> {
  try {
    await enqueueBridgeRequest('/bridge/jlceda/component/place/close', {
      sessionId,
    }, DEFAULT_BRIDGE_TIMEOUT_MS);
  }
  catch {
    return;
  }
}

export async function handleComponentSelectFlow(
  argumentsObject: Record<string, unknown>,
  dependencies: InteractiveToolFlowDependencies,
): Promise<unknown> {
  const keyword = String(argumentsObject.keyword ?? '').trim();
  if (keyword.length === 0) {
    throw new Error('component_select 缺少 keyword 参数。');
  }

  if (NET_FLAG_KEYWORDS.has(keyword.toLowerCase())) {
    return {
      ok: false,
      errorCode: 'NET_FLAG_NOT_SELECTABLE',
      message: `电源/地符号（${keyword}）不需要选型，也不能通过 component_place 放置。电源/地符号需要用户在 EDA 中手动放置。`,
    };
  }

  if (dependencies.skippedSelectKeywords.has(keyword.toLowerCase())) {
    return {
      ok: true,
      skipped: true,
      skipReason: 'user-already-skipped',
      message: `用户已跳过“${keyword}”的器件选型，禁止重试。请直接进行下一步。`,
    };
  }

  const limit = parseBoundedIntegerValue(argumentsObject.limit, 20, 2, 20);
  const initialResult = await enqueueBridgeRequest('/bridge/jlceda/component/select', {
    keyword,
    limit,
    page: 1,
  }, DEFAULT_BRIDGE_TIMEOUT_MS);
  const initialPayload = parseComponentSelectBridgePayload(initialResult);
  if (!initialPayload) {
    return initialResult;
  }

  const requestId = createInteractionRequestId('component_select');
  let interaction: SidebarComponentSelectInteraction = {
    kind: 'component-select',
    requestId,
    keyword,
    title: initialPayload.title,
    description: initialPayload.description,
    noticeText: '',
    candidates: initialPayload.candidates,
    pageSize: initialPayload.pageSize,
    currentPage: initialPayload.currentPage,
    timeoutSeconds: Math.floor(SIDEBAR_INTERACTION_TIMEOUT_MS / 1000),
  };

  writeInteractionRequest(dependencies.interactionChannel, null);
  writeInteractionRequest(dependencies.interactionChannel, interaction);
  try {
    while (true) {
      const response = await waitForInteractionResponse(
        dependencies.interactionChannel,
        requestId,
        ['cancel', 'change-page', 'confirm-selection'],
      );

      if (response.action === 'cancel') {
        dependencies.skippedSelectKeywords.add(keyword.toLowerCase());
        return {
          ok: true,
          skipped: true,
          skipReason: 'user-skipped-selection',
          message: `用户跳过了“${keyword}”的器件选型，禁止重试。请直接进行下一步，不得就该器件再做任何动作。`,
        };
      }

      if (response.action === 'confirm-selection') {
        const selectedCandidate = interaction.candidates.find((candidate) => {
          return candidate.uuid === response.candidate.uuid && candidate.libraryUuid === response.candidate.libraryUuid;
        });
        if (!selectedCandidate) {
          interaction = {
            ...interaction,
            noticeText: '当前选择项已失效，请重新从当前列表中选择器件。',
          };
          writeInteractionRequest(dependencies.interactionChannel, interaction);
          continue;
        }

        return {
          ok: true,
          selectedCandidate,
          message: `用户已最终确认器件：${selectedCandidate.name || selectedCandidate.uuid}。后续必须以该器件为准，不得因 AI 预期不一致而要求用户重新选型，也不得自行改选其他候选器件。`,
        };
      }

      if (response.action !== 'change-page') {
        continue;
      }

      try {
        const nextPayload = await fetchComponentSelectPage(keyword, limit, response.page);
        interaction = {
          ...interaction,
          title: nextPayload.title,
          description: nextPayload.description,
          noticeText: '',
          candidates: nextPayload.candidates,
          pageSize: nextPayload.pageSize,
          currentPage: nextPayload.currentPage,
        };
      }
      catch (error: unknown) {
        interaction = {
          ...interaction,
          noticeText: `加载第 ${String(response.page)} 页失败：${toSafeErrorMessage(error)}`,
        };
      }

      writeInteractionRequest(dependencies.interactionChannel, interaction);
    }
  }
  finally {
    writeInteractionRequest(dependencies.interactionChannel, null);
  }
}

export async function handleComponentPlaceFlow(
  argumentsObject: Record<string, unknown>,
  dependencies: InteractiveToolFlowDependencies,
): Promise<unknown> {
  const components = argumentsObject.components;
  if (!Array.isArray(components)) {
    throw new Error('component_place 缺少 components 参数，且其必须为数组。');
  }

  const timeoutSeconds = parseBoundedIntegerValue(argumentsObject.timeoutSeconds, 60, 30, 180);
  const initialResult = await enqueueBridgeRequest('/bridge/jlceda/component/place', {
    components,
    timeoutSeconds,
  }, DEFAULT_BRIDGE_TIMEOUT_MS);
  const placementPayload = parseComponentPlaceBridgePayload(initialResult);
  if (!placementPayload) {
    return initialResult;
  }

  const requestId = createInteractionRequestId('component_place');
  const placedComponents: SidebarComponentPlaceItem[] = [];
  const skippedComponents: SidebarComponentPlaceItem[] = [];
  const interaction: SidebarComponentPlaceInteraction = {
    kind: 'component-place',
    requestId,
    title: placementPayload.title,
    description: placementPayload.description,
    noticeText: '',
    totalCount: placementPayload.components.length,
    placedCount: 0,
    statusText: '等待开始',
    timeoutSeconds: placementPayload.timeoutSeconds,
    retryCount: placementPayload.retryCount,
    started: false,
    canStart: true,
    canCancel: true,
    rows: createInitialPlaceRows(placementPayload.components),
  };

  const writePlaceInteraction = (): void => {
    writeInteractionRequest(dependencies.interactionChannel, interaction);
  };

  const finalizeCancelled = (): Record<string, unknown> => {
    return {
      ok: false,
      error: '用户在开始放置前取消了操作，请勿重试，直接告知用户已取消并停止。',
      errorCode: 'COMPONENT_PLACE_CANCELLED',
      placedCount: placedComponents.length,
      totalCount: placementPayload.components.length,
      placedComponents,
      skippedComponents,
    };
  };

  writeInteractionRequest(dependencies.interactionChannel, null);
  writePlaceInteraction();
  try {
    const startResponse = await waitForInteractionResponse(
      dependencies.interactionChannel,
      requestId,
      ['cancel', 'start-placement'],
    );
    if (startResponse.action === 'cancel') {
      return finalizeCancelled();
    }

    interaction.started = true;
    interaction.canStart = false;
    interaction.canCancel = true;
    interaction.statusText = '已开始放置，请按顺序在原理图中点击放置器件。';
    writePlaceInteraction();

    for (let index = 0; index < placementPayload.components.length; index += 1) {
      const component = placementPayload.components[index];
      if (tryConsumeInteractionCancel(dependencies.interactionChannel, requestId)) {
        skippedComponents.push(component);
        interaction.rows[index].status = 'skipped';
        interaction.rows[index].statusText = '已跳过';
        interaction.statusText = `已跳过第 ${String(index + 1)} 个器件，继续下一个。`;
        writePlaceInteraction();
        continue;
      }

      for (let attempt = 1; attempt <= placementPayload.retryCount + 1; attempt += 1) {
        const isRetry = attempt > 1;
        interaction.rows[index].status = 'active';
        interaction.rows[index].statusText = isRetry ? `重试第 ${String(attempt - 1)} 次` : '等待放置';
        interaction.rows[index].detail = formatPlaceComponentDetail(component);
        interaction.statusText = `请在原理图中放置第 ${String(index + 1)} / ${String(placementPayload.components.length)} 个器件${isRetry ? '（重试）' : ''}`;
        interaction.noticeText = '';
        writePlaceInteraction();

        const startResult = await startComponentPlaceAttempt(component, placementPayload.timeoutSeconds);
        if (!startResult.ok || !startResult.sessionId) {
          interaction.rows[index].status = 'error';
          interaction.rows[index].statusText = '放置失败';
          interaction.rows[index].detail = `${formatPlaceComponentDetail(component)}  ${startResult.error || '未能启动交互放置会话。'}`;
          interaction.statusText = '放置失败';
          interaction.noticeText = startResult.error || '未能启动交互放置会话。';
          writePlaceInteraction();
          return {
            ok: false,
            error: `第 ${String(index + 1)} 个器件放置失败：${startResult.error || '未能启动交互放置会话。'}`,
            errorCode: 'COMPONENT_PLACE_API_ERROR',
            placedCount: placedComponents.length,
            totalCount: placementPayload.components.length,
            placedComponents,
            failedIndex: index + 1,
            failedComponent: component,
          };
        }

        const sessionId = startResult.sessionId;
        const startedAt = Date.now();
        let placed = false;
        let skippedByUser = false;
        while (Date.now() - startedAt < placementPayload.timeoutSeconds * 1000) {
          if (tryConsumeInteractionCancel(dependencies.interactionChannel, requestId)) {
            await closeComponentPlaceAttempt(sessionId);
            skippedByUser = true;
            break;
          }

          await sleep(COMPONENT_PLACE_CHECK_INTERVAL_MS);
          const checkResult = await checkComponentPlaceAttempt(sessionId);
          if (!checkResult.ok) {
            await closeComponentPlaceAttempt(sessionId);
            interaction.rows[index].status = 'error';
            interaction.rows[index].statusText = '放置失败';
            interaction.rows[index].detail = `${formatPlaceComponentDetail(component)}  ${checkResult.error || '轮询器件放置状态失败。'}`;
            interaction.statusText = '放置失败';
            interaction.noticeText = checkResult.error || '轮询器件放置状态失败。';
            writePlaceInteraction();
            return {
              ok: false,
              error: `第 ${String(index + 1)} 个器件放置失败：${checkResult.error || '轮询器件放置状态失败。'}`,
              errorCode: 'COMPONENT_PLACE_API_ERROR',
              placedCount: placedComponents.length,
              totalCount: placementPayload.components.length,
              placedComponents,
              failedIndex: index + 1,
              failedComponent: component,
            };
          }

          if (checkResult.placed) {
            placed = true;
            break;
          }

          if (checkResult.userCancelled) {
            skippedByUser = true;
            break;
          }
        }

        if (placed) {
          placedComponents.push(component);
          interaction.placedCount = placedComponents.length;
          interaction.rows[index].status = 'success';
          interaction.rows[index].statusText = '已完成';
          interaction.statusText = `已完成第 ${String(index + 1)} 个器件放置。`;
          interaction.noticeText = '';
          writePlaceInteraction();
          break;
        }

        if (skippedByUser) {
          skippedComponents.push(component);
          interaction.rows[index].status = 'skipped';
          interaction.rows[index].statusText = '已跳过';
          interaction.statusText = `已跳过第 ${String(index + 1)} 个器件，继续下一个。`;
          interaction.noticeText = '';
          writePlaceInteraction();
          break;
        }

        if (attempt < placementPayload.retryCount + 1) {
          await closeComponentPlaceAttempt(sessionId);
          continue;
        }

        await closeComponentPlaceAttempt(sessionId);
        interaction.rows[index].status = 'error';
        interaction.rows[index].statusText = '超时失败';
        interaction.rows[index].detail = `${formatPlaceComponentDetail(component)}  已达到最大重试次数。`;
        interaction.statusText = '放置失败';
        interaction.noticeText = `第 ${String(index + 1)} 个器件放置超时，自动重试 ${String(placementPayload.retryCount)} 次后仍未完成。`;
        writePlaceInteraction();
        return {
          ok: false,
          error: `第 ${String(index + 1)} 个器件放置超时，自动重试 ${String(placementPayload.retryCount)} 次后仍未完成。`,
          errorCode: 'COMPONENT_PLACE_TIMEOUT',
          placedCount: placedComponents.length,
          totalCount: placementPayload.components.length,
          placedComponents,
          failedIndex: index + 1,
          failedComponent: component,
        };
      }
    }

    interaction.canCancel = false;
    const finalPlacedCount = placedComponents.length;
    const finalSkippedCount = skippedComponents.length;
    const finalMessage = finalSkippedCount > 0
      ? `共 ${String(placementPayload.components.length)} 个器件：已放置 ${String(finalPlacedCount)} 个，用户跳过 ${String(finalSkippedCount)} 个。`
      : `已完成全部 ${String(placementPayload.components.length)} 个器件的交互放置。`;
    interaction.statusText = finalMessage;
    interaction.noticeText = '';
    writePlaceInteraction();
    return {
      ok: true,
      placedCount: finalPlacedCount,
      totalCount: placementPayload.components.length,
      placedComponents,
      skippedCount: finalSkippedCount,
      skippedComponents,
      message: finalMessage,
    };
  }
  finally {
    writeInteractionRequest(dependencies.interactionChannel, null);
  }
}
