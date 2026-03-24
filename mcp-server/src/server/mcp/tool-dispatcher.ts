/**
 * ------------------------------------------------------------------------
 * 名称：MCP 工具分发器
 * 说明：按工具名分发到检索或桥接执行路径。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：所有桥接任务仅发送到服务端判定的活动客户端。
 * ------------------------------------------------------------------------
 */

import { enqueueBridgeRequest } from '../bridge/broker';
import {
	clearSidebarInteractionRequest,
	clearSidebarInteractionResponse,
	type SidebarComponentPlaceInteraction,
	type SidebarComponentPlaceItem,
	type SidebarComponentPlaceRowState,
	type SidebarComponentSelectCandidate,
	type SidebarComponentSelectInteraction,
	type SidebarInteractionRequest,
	type SidebarInteractionResponse,
	readSidebarInteractionResponse,
	writeSidebarInteractionRequest,
} from '../../state/sidebar-interaction';
import { isPlainObjectRecord, parseBoundedIntegerValue, toSafeErrorMessage } from '../../utils';
import _rawToolDefinitions from '../../data/jlceda-mcp-tool-definitions.json';

export interface ToolCallParams {
	name: string;
	arguments?: Record<string, unknown>;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

const DEFAULT_BRIDGE_TIMEOUT_MS = 15_000;
const SIDEBAR_INTERACTION_TIMEOUT_MS = 15 * 60 * 1000;
const SIDEBAR_INTERACTION_POLL_INTERVAL_MS = 250;
const COMPONENT_PLACE_CHECK_INTERVAL_MS = 400;

const EXPOSED_MCP_TOOL_NAMES = new Set<string>([
	// 'jlceda_api_index',
	// 'jlceda_api_search',
	// 'jlceda_context_get',
	// 'jlceda_api_invoke',
	'schematic_check',
	'component_select',
	'component_place',
]);

const TOOL_DEFINITIONS = loadToolDefinitions();

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
	error?: string;
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

// 加载并校验工具定义。
function loadToolDefinitions(): readonly ToolDefinition[] {
	const parsed: unknown = _rawToolDefinitions;
	if (!Array.isArray(parsed)) {
		throw new Error('工具定义文件格式非法：根节点必须是数组。');
	}

	const definitions: ToolDefinition[] = [];
	for (const item of parsed) {
		if (!isPlainObjectRecord(item)) {
			throw new Error('工具定义项必须为对象。');
		}

		const name = String(item.name ?? '').trim();
		const description = String(item.description ?? '').trim();
		if (name.length === 0 || description.length === 0) {
			throw new Error('工具定义项缺少 name 或 description。');
		}
		if (!isPlainObjectRecord(item.inputSchema)) {
			throw new Error(`工具 ${name} 缺少 inputSchema 对象。`);
		}

		definitions.push({
			name,
			description,
			inputSchema: item.inputSchema,
		});
	}
	return definitions.filter(item => EXPOSED_MCP_TOOL_NAMES.has(item.name));
}

export class ToolDispatcher {
	public constructor(
		private readonly storageDirectoryPath: string,
		private readonly sessionId: string,
	) {}

	/**
	 * 返回工具定义列表。
	 * @returns 工具定义。
	 */
	public getToolDefinitions(): readonly ToolDefinition[] {
		return TOOL_DEFINITIONS;
	}

	/**
	 * 分发工具调用。
	 * @param toolCallParams 工具调用参数。
	 * @returns 工具响应。
	 */
	public async dispatch(toolCallParams: ToolCallParams): Promise<unknown> {
		const args = isPlainObjectRecord(toolCallParams.arguments) ? toolCallParams.arguments : {};
		if (!EXPOSED_MCP_TOOL_NAMES.has(toolCallParams.name)) {
			throw new Error(`未知工具: ${toolCallParams.name}`);
		}
		if (toolCallParams.name === 'schematic_check') {
			return this.toToolContent(await this.handleSchematicCheck());
		}
		if (toolCallParams.name === 'component_select') {
			return this.toToolContent(await this.handleComponentSelect(args));
		}
		if (toolCallParams.name === 'component_place') {
			return this.toToolContent(await this.handleComponentPlace(args));
		}

		throw new Error(`未知工具: ${toolCallParams.name}`);
	}

	// MCP tools/call 返回结构封装。
	private toToolContent(result: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent: unknown } {
		return {
			content: [{
				type: 'text',
				text: JSON.stringify(result, null, 2),
			}],
			structuredContent: result,
		};
	}

	// 桥接执行离线文档检索。
	private async handleApiSearch(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const query = String(argumentsObject.query ?? '').trim();
		if (query.length === 0) {
			throw new Error('jlceda_api_search 缺少 query 参数。');
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

	// 桥接执行 API 调用。
	private async handleApiInvoke(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const apiFullName = String(argumentsObject.apiFullName ?? '').trim();
		if (apiFullName.length === 0) {
			throw new Error('jlceda_api_invoke 缺少 apiFullName 参数。');
		}

		const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
		const invokeArgs = Array.isArray(argumentsObject.args) ? argumentsObject.args : [];
		// invoke-handler 返回的结构已包含 apiFullName、argsCount、result，无需再次包装。
		return await enqueueBridgeRequest('/bridge/jlceda/api/invoke', {
			apiFullName,
			args: invokeArgs,
		}, timeoutMs);
	}

	// 桥接读取上下文。
	private async handleContextGet(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
		const scope = String(argumentsObject.scope ?? '').trim();
		// context-handler 返回的结构已包含 scope 字段，无需再次包装。
		return await enqueueBridgeRequest('/bridge/jlceda/context/get', { scope }, timeoutMs);
	}

	// 桥接执行原理图完整检查（ERC + 网表提取）。
	private async handleSchematicCheck(): Promise<unknown> {
		return await enqueueBridgeRequest('/bridge/jlceda/schematic/check', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
	}

	private writeInteractionRequest(request: SidebarInteractionRequest): void {
		writeSidebarInteractionRequest(this.storageDirectoryPath, this.sessionId, request);
	}

	private clearInteractionState(): void {
		clearSidebarInteractionRequest(this.storageDirectoryPath, this.sessionId);
		clearSidebarInteractionResponse(this.storageDirectoryPath, this.sessionId);
	}

	private consumeInteractionResponse(requestId: string, acceptedActions: SidebarInteractionResponse['action'][]): SidebarInteractionResponse | null {
		const response = readSidebarInteractionResponse(this.storageDirectoryPath, this.sessionId);
		if (!response || response.requestId !== requestId || !acceptedActions.includes(response.action)) {
			return null;
		}

		clearSidebarInteractionResponse(this.storageDirectoryPath, this.sessionId);
		return response;
	}

	private async waitForInteractionResponse(requestId: string, acceptedActions: SidebarInteractionResponse['action'][]): Promise<SidebarInteractionResponse> {
		const startedAt = Date.now();
		while (Date.now() - startedAt < SIDEBAR_INTERACTION_TIMEOUT_MS) {
			const response = this.consumeInteractionResponse(requestId, acceptedActions);
			if (response) {
				return response;
			}

			await sleep(SIDEBAR_INTERACTION_POLL_INTERVAL_MS);
		}

		throw new Error('侧边栏交互等待超时，请重新发起当前工具调用。');
	}

	private tryConsumeInteractionCancel(requestId: string): boolean {
		const response = this.consumeInteractionResponse(requestId, ['cancel']);
		return response?.action === 'cancel';
	}

	private parseComponentSelectBridgePayload(result: unknown): ComponentSelectBridgePayload | null {
		if (!isPlainObjectRecord(result) || result.ok !== true || !isPlainObjectRecord(result.selection)) {
			return null;
		}

		const selection = result.selection;
		if (!Array.isArray(selection.candidates)) {
			return null;
		}

		const candidates = selection.candidates
			.filter((candidate): candidate is SidebarComponentSelectCandidate => {
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

	private parseComponentPlaceBridgePayload(result: unknown): ComponentPlaceBridgePayload | null {
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

	private async fetchComponentSelectPage(keyword: string, limit: number, page: number): Promise<ComponentSelectBridgePayload> {
		const result = await enqueueBridgeRequest('/bridge/jlceda/component/select', {
			keyword,
			limit,
			page,
		}, DEFAULT_BRIDGE_TIMEOUT_MS);
		const payload = this.parseComponentSelectBridgePayload(result);
		if (!payload) {
			throw new Error('器件选型分页结果格式非法。');
		}

		return payload;
	}

	private async startComponentPlaceAttempt(component: SidebarComponentPlaceItem, timeoutSeconds: number): Promise<ComponentPlaceStartResult> {
		const result = await enqueueBridgeRequest('/bridge/jlceda/component/place/start', {
			component,
			timeoutSeconds,
		}, DEFAULT_BRIDGE_TIMEOUT_MS);
		if (!isPlainObjectRecord(result) || typeof result.ok !== 'boolean') {
			throw new Error('器件放置启动结果格式非法。');
		}

		return {
			ok: result.ok,
			sessionId: typeof result.sessionId === 'string' ? result.sessionId : undefined,
			error: typeof result.error === 'string' ? result.error : undefined,
		};
	}

	private async checkComponentPlaceAttempt(sessionId: string): Promise<ComponentPlaceCheckResult> {
		const result = await enqueueBridgeRequest('/bridge/jlceda/component/place/check', {
			sessionId,
		}, DEFAULT_BRIDGE_TIMEOUT_MS);
		if (!isPlainObjectRecord(result) || typeof result.ok !== 'boolean') {
			throw new Error('器件放置轮询结果格式非法。');
		}

		return {
			ok: result.ok,
			placed: typeof result.placed === 'boolean' ? result.placed : undefined,
			error: typeof result.error === 'string' ? result.error : undefined,
		};
	}

	private async closeComponentPlaceAttempt(sessionId: string): Promise<void> {
		try {
			await enqueueBridgeRequest('/bridge/jlceda/component/place/close', {
				sessionId,
			}, DEFAULT_BRIDGE_TIMEOUT_MS);
		}
		catch {
			// 清理失败时不覆盖主流程结果。
		}
	}

	// 桥接执行器件搜索。
	private async handleComponentSelect(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const keyword = String(argumentsObject.keyword ?? '').trim();
		if (keyword.length === 0) {
			throw new Error('component_select 缺少 keyword 参数。');
		}

		const limit = parseBoundedIntegerValue(argumentsObject.limit, 20, 2, 20);
		const initialResult = await enqueueBridgeRequest('/bridge/jlceda/component/select', {
			keyword,
			limit,
			page: 1,
		}, DEFAULT_BRIDGE_TIMEOUT_MS);
		const initialPayload = this.parseComponentSelectBridgePayload(initialResult);
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
		};

		this.clearInteractionState();
		this.writeInteractionRequest(interaction);
		try {
			while (true) {
				const response = await this.waitForInteractionResponse(requestId, ['cancel', 'change-page', 'confirm-selection']);
				if (response.action === 'cancel') {
					return {
						ok: true,
						skipped: true,
						skipReason: 'user-skipped-selection',
						message: '用户跳过了当前器件选型，请不要放置该器件，继续处理后续步骤，不要重试当前器件选型。',
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
						this.writeInteractionRequest(interaction);
						continue;
					}

					return {
						ok: true,
						selectedCandidate,
						message: `用户已选择器件：${selectedCandidate.name || selectedCandidate.uuid}`,
					};
				}

				if (response.action !== 'change-page') {
					continue;
				}

				try {
					const nextPayload = await this.fetchComponentSelectPage(keyword, limit, response.page);
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

				this.writeInteractionRequest(interaction);
			}
		}
		finally {
			this.clearInteractionState();
		}
	}

	// 桥接创建器件交互放置任务。
	private async handleComponentPlace(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const components = argumentsObject.components;
		if (!Array.isArray(components)) {
			throw new Error('component_place 缺少 components 参数，且其必须为数组。');
		}

		const timeoutSeconds = parseBoundedIntegerValue(argumentsObject.timeoutSeconds, 60, 30, 180);
		const initialResult = await enqueueBridgeRequest('/bridge/jlceda/component/place', {
			components,
			timeoutSeconds,
		}, DEFAULT_BRIDGE_TIMEOUT_MS);
		const placementPayload = this.parseComponentPlaceBridgePayload(initialResult);
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
			this.writeInteractionRequest(interaction);
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

		this.clearInteractionState();
		writePlaceInteraction();
		try {
			const startResponse = await this.waitForInteractionResponse(requestId, ['cancel', 'start-placement']);
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
				if (this.tryConsumeInteractionCancel(requestId)) {
					// 放置开始前点了跳过：标记当前器件已跳过，继续下一个
					skippedComponents.push(component);
					interaction.rows[index].status = 'skipped';
					interaction.rows[index].statusText = '已跳过';
					interaction.statusText = `已跳过第 ${String(index + 1)} 个器件，继续下一个。`;
					writePlaceInteraction();
					continue;
				}

				let placedCurrentComponent = false;
				for (let attempt = 1; attempt <= placementPayload.retryCount + 1; attempt += 1) {
					const isRetry = attempt > 1;
					interaction.rows[index].status = 'active';
					interaction.rows[index].statusText = isRetry ? `重试第 ${String(attempt - 1)} 次` : '等待放置';
					interaction.rows[index].detail = formatPlaceComponentDetail(component);
					interaction.statusText = `请在原理图中放置第 ${String(index + 1)} / ${String(placementPayload.components.length)} 个器件${isRetry ? '（重试）' : ''}`;
					interaction.noticeText = '';
					writePlaceInteraction();

					const startResult = await this.startComponentPlaceAttempt(component, placementPayload.timeoutSeconds);
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
						if (this.tryConsumeInteractionCancel(requestId)) {
							await this.closeComponentPlaceAttempt(sessionId);
							// 放置开始后点了跳过：标记当前器件已跳过，继续下一个
							skippedByUser = true;
							break;
						}

						await sleep(COMPONENT_PLACE_CHECK_INTERVAL_MS);
						const checkResult = await this.checkComponentPlaceAttempt(sessionId);
						if (!checkResult.ok) {
							await this.closeComponentPlaceAttempt(sessionId);
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
					}

					if (placed) {
						placedComponents.push(component);
						interaction.placedCount = placedComponents.length;
						interaction.rows[index].status = 'success';
						interaction.rows[index].statusText = '已完成';
						interaction.statusText = `已完成第 ${String(index + 1)} 个器件放置。`;
						interaction.noticeText = '';
						writePlaceInteraction();
						placedCurrentComponent = true;
						break;
					}

						if (skippedByUser) {
							skippedComponents.push(component);
							interaction.rows[index].status = 'skipped';
							interaction.rows[index].statusText = '已跳过';
							interaction.statusText = `已跳过第 ${String(index + 1)} 个器件，继续下一个。`;
							interaction.noticeText = '';
							writePlaceInteraction();
							placedCurrentComponent = true;
							break;
						}

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

				if (!placedCurrentComponent) {
					break;
				}
			}

			interaction.canCancel = false;
			interaction.statusText = `已完成全部 ${String(placementPayload.components.length)} 个器件的交互放置。`;
			interaction.noticeText = '';
			writePlaceInteraction();
			return {
				ok: true,
				placedCount: placedComponents.length,
				totalCount: placementPayload.components.length,
				placedComponents,
				skippedCount: skippedComponents.length,
				skippedComponents,
				message: `已完成全部 ${String(placementPayload.components.length)} 个器件的交互放置。`,
			};
		}
		finally {
			this.clearInteractionState();
		}
	}
}
