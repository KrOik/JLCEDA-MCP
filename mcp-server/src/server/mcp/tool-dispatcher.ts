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
	type SidebarNetFlagWaitInteraction,
	type SidebarWirePlanConnectionRow,
	type SidebarWirePlanInteraction,
	readSidebarInteractionResponse,
	writeSidebarInteractionRequest,
} from '../../state/sidebar-interaction';
import { isPlainObjectRecord, parseBoundedIntegerValue, toSafeErrorMessage } from '../../utils';
import _rawToolDefinitions from '../../data/mcp-tool-definitions.json';

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
	// 'api_index',
	// 'api_search',
	// 'eda_context',
	// 'api_invoke',
	'schematic_topology',
	'schematic_netlist',
	'component_select',
	'component_place',
	'schematic_wire_plan',
	'schematic_wire_execute',
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
	// VCC/GND 等电源/地符号关键词（小写）集合，命中时硬拦截选型、不弹面板。
	private static readonly NET_FLAG_KEYWORDS = new Set([
		'vcc', 'gnd', 'ground', 'power', 'vdd', 'vss',
		'电源', '地', '电源符号', '地符号', 'vcc符号', 'gnd符号',
		'power symbol', 'ground symbol',
	]);

	// 同一会话内用户已跳过的选型关键词（小写），硬拦截重复弹面板。
	private readonly skippedSelectKeywords = new Set<string>();

	public constructor(
		private readonly storageDirectoryPath: string,
		private readonly sessionId: string,
	) { }

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
		if (toolCallParams.name === 'schematic_topology') {
			return this.toToolContent(await this.handleSchematicTopology());
		}
		if (toolCallParams.name === 'schematic_netlist') {
			return this.toToolContent(await this.handleSchematicNetlist());
		}
		if (toolCallParams.name === 'component_select') {
			return this.toToolContent(await this.handleComponentSelect(args));
		}
		if (toolCallParams.name === 'component_place') {
			return this.toToolContent(await this.handleComponentPlace(args));
		}
		if (toolCallParams.name === 'schematic_wire_plan') {
			return this.toToolContent(await this.handleSchematicWirePlan(args));
		}
		if (toolCallParams.name === 'schematic_wire_execute') {
			return this.toToolContent(await this.handleSchematicWireExecute(args));
		}
		if (toolCallParams.name === 'api_index') {
			return this.toToolContent(await this.handleApiIndex(args));
		}
		if (toolCallParams.name === 'api_search') {
			return this.toToolContent(await this.handleApiSearch(args));
		}
		if (toolCallParams.name === 'api_invoke') {
			return this.toToolContent(await this.handleApiInvoke(args));
		}
		if (toolCallParams.name === 'eda_context') {
			return this.toToolContent(await this.handleEdaContext(args));
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

	// 桥接执行 API 索引查询。
	private async handleApiIndex(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const owner = String(argumentsObject.owner ?? '').trim();
		return await enqueueBridgeRequest('/bridge/jlceda/api/index', { owner }, DEFAULT_BRIDGE_TIMEOUT_MS);
	}

	// 桥接执行离线文档检索。
	private async handleApiSearch(argumentsObject: Record<string, unknown>): Promise<unknown> {
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

	// 桥接执行 API 调用。
	private async handleApiInvoke(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const apiFullName = String(argumentsObject.apiFullName ?? '').trim();
		if (apiFullName.length === 0) {
			throw new Error('api_invoke 缺少 apiFullName 参数。');
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
	private async handleEdaContext(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const timeoutMs = parseBoundedIntegerValue(argumentsObject.timeoutMs, DEFAULT_BRIDGE_TIMEOUT_MS, 1000, 120000);
		const scope = String(argumentsObject.scope ?? '').trim();
		// context-handler 返回的结构已包含 scope 字段，无需再次包装。
		return await enqueueBridgeRequest('/bridge/jlceda/context', { scope }, timeoutMs);
	}

	// 桥接执行原理图 ERC + 拓扑快照提取（为自动连线准备数据）。
	private async handleSchematicTopology(): Promise<unknown> {
		return await enqueueBridgeRequest('/bridge/jlceda/schematic/topology', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
	}

	// 桥接获取原理图完整网表（供 AI 功能性分析）。
	private async handleSchematicNetlist(): Promise<unknown> {
		return await enqueueBridgeRequest('/bridge/jlceda/schematic/netlist', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
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
			// 超时对象（含 timeout: true）或格式非法：统一作为启动失败处理，不抛出。
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

		// 硬拦截 1：VCC/GND 等电源/地符号不进选型流程，直接返回错误。
		// 这类符号由用户在 EDA 中手动放置，schematic_wire_plan 会自动弹出等待面板。
		if (ToolDispatcher.NET_FLAG_KEYWORDS.has(keyword.toLowerCase())) {
			return {
				ok: false,
				errorCode: 'NET_FLAG_NOT_SELECTABLE',
				message: `电源/地符号（${keyword}）不需要选型，也不能通过 component_place 放置。请直接调用 schematic_wire_plan，工具会在连线前自动检测并弹出等待面板提示用户在 EDA 中手动放置所需符号，用户确认完成后自动继续连线。`,
			};
		}

		// 硬拦截 2：同一会话内用户已跳过的关键词，直接返回跳过结果，不弹面板。
		if (this.skippedSelectKeywords.has(keyword.toLowerCase())) {
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
					// 记录已跳过的关键词，同一会话内后续相同关键词的调用将被硬拦截。
					this.skippedSelectKeywords.add(keyword.toLowerCase());
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
						this.writeInteractionRequest(interaction);
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

	// 连线规划：校验 AI 的逻辑连接声明，由用户在侧边栏确认方法后返回 planId。
	private async handleSchematicWirePlan(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const connections = argumentsObject.connections;
		if (!Array.isArray(connections)) {
			throw new Error('schematic_wire_plan 缺少 connections 数组参数。');
		}

		// 连线前检查原理图中是否存在此次 connections 实际引用的 VCC/GND 符号。
		const missingNetFlags = await this.checkMissingNetFlags(connections);
		if (missingNetFlags.length > 0) {
			const waitResult = await this.waitForNetFlagPlacement(missingNetFlags);
			if (!waitResult.ok) {
				return waitResult;
			}
		}

		// 预校验：netName 为 VCC/GND 时，必须至少有一端 refDes 是 VCC/GND。
		// 若两端都不是电源符号端点，连线根本无法落到电源符号上，直接拒绝。
		const NET_FLAG_NAMES = new Set(['VCC', 'GND']);
		const powerEndpointErrors: string[] = [];
		for (let i = 0; i < connections.length; i++) {
			const conn = connections[i];
			if (!isPlainObjectRecord(conn)) {
				continue;
			}
			const netName = String(conn.netName ?? '').trim().toUpperCase();
			if (!NET_FLAG_NAMES.has(netName)) {
				continue;
			}
			const fromRefDes = isPlainObjectRecord(conn.from) ? String(conn.from.refDes ?? '').trim().toUpperCase() : '';
			const toRefDes = isPlainObjectRecord(conn.to) ? String(conn.to.refDes ?? '').trim().toUpperCase() : '';
			if (!NET_FLAG_NAMES.has(fromRefDes) && !NET_FLAG_NAMES.has(toRefDes)) {
				powerEndpointErrors.push(
					`connections[${i}]：netName 为 "${netName}"，但 from.refDes="${String(isPlainObjectRecord(conn.from) ? conn.from.refDes : '')}" 和 to.refDes="${String(isPlainObjectRecord(conn.to) ? conn.to.refDes : '')}" 均不是 VCC/GND 符号端点。` +
					`接电源/地时必须将 from 或 to 的 refDes 设为 "VCC" 或 "GND"，并将 pin 设为 "VCC" 或 "GND"。`,
				);
			}
		}
		if (powerEndpointErrors.length > 0) {
			return {
				ok: false,
				errorCode: 'POWER_ENDPOINT_MISSING',
				error: `连线规划被拒绝：以下连接的 netName 是电源/地网络，但没有指定 VCC/GND 符号作为端点。请修正后重新提交。`,
				validationErrors: powerEndpointErrors,
			};
		}

		// 发到 bridge 执行校验并生成 planId。
		const bridgeResult = await enqueueBridgeRequest('/bridge/jlceda/schematic/wire/plan', { connections }, DEFAULT_BRIDGE_TIMEOUT_MS);

		if (!isPlainObjectRecord(bridgeResult) || bridgeResult.ok !== true) {
			return bridgeResult;
		}

		// 校验通过，从 bridge 结果中取连接摘要，展示侧边栏确认面板。
		const planId = String(bridgeResult.planId ?? '').trim();
		const rawConnections = Array.isArray(bridgeResult.connections) ? bridgeResult.connections : [];

		const connectionRows: SidebarWirePlanConnectionRow[] = rawConnections
			.filter(isPlainObjectRecord)
			.map((item, index) => ({
				index: typeof item.index === 'number' ? item.index : index,
				fromLabel: String(item.fromLabel ?? ''),
				toLabel: String(item.toLabel ?? ''),
				netName: String(item.netName ?? ''),
			}));

		const requestId = createInteractionRequestId('schematic_wire_plan');
		const interaction: SidebarWirePlanInteraction = {
			kind: 'wire-plan',
			requestId,
			title: '连线规划确认',
			description: `AI 规划了 ${String(connectionRows.length)} 条连线，请选择连接方式并确认后执行。`,
			noticeText: '',
			connectionMethod: 'net-label',
			connections: connectionRows,
			canConfirm: true,
			canCancel: true,
		};

		this.clearInteractionState();
		this.writeInteractionRequest(interaction);
		try {
			const response = await this.waitForInteractionResponse(requestId, ['cancel', 'confirm-wire-plan']);
			if (response.action === 'cancel') {
				return {
					ok: false,
					cancelled: true,
					message: '用户取消了连线规划，请勿重试，直接告知用户已取消并停止。',
				};
			}

			if (response.action === 'confirm-wire-plan') {
				const connectionMethod = response.connectionMethod;
				return {
					ok: true,
					planId,
					connectionMethod,
					connectionCount: connectionRows.length,
					connections: connectionRows,
					message: `连线规划已确认，共 ${String(connectionRows.length)} 条，连接方式：${connectionMethod === 'net-label' ? '网络标签' : '导线'}。请立即调用 schematic_wire_execute 执行连线，传入 planId 和 connectionMethod。`,
				};
			}

			throw new Error('收到无效的侧边栏响应。');
		}
		finally {
			this.clearInteractionState();
		}
	}

	// 从拓扑中提取已存在的网络标识符号名称集合。
	private extractExistingNetFlagNames(topologyResult: unknown): Set<string> {
		const names = new Set<string>();
		if (!isPlainObjectRecord(topologyResult) || topologyResult.ok !== true) {
			return names;
		}

		const topologyJson = String(topologyResult.schematicTopology ?? '');
		if (topologyJson.length === 0) {
			return names;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(topologyJson) as unknown;
		}
		catch {
			return names;
		}

		if (!isPlainObjectRecord(parsed) || !Array.isArray(parsed.components)) {
			return names;
		}

		for (const comp of parsed.components) {
			if (!isPlainObjectRecord(comp)) {
				continue;
			}
			const designator = String(comp.designator ?? '').trim();
			const pcbFootprintUuid = String(comp.pcbFootprintUuid ?? '').trim();
			// 网络标识符号无封装且位号即网络名称（如 VCC、GND）。
			if (designator.length > 0 && pcbFootprintUuid.length === 0) {
				names.add(designator.toUpperCase());
			}
		}

		return names;
	}

	// 连线规划前按需检查：只检查 connections 中实际引用的 VCC/GND 符号是否已放置。
	private async checkMissingNetFlags(connections: unknown[]): Promise<string[]> {
		const REQUIRED_NET_FLAGS = ['VCC', 'GND'];

		// 收集本次 connections 实际引用的电源/地符号名称。
		// 同时扫描 from.refDes、to.refDes 和 netName：
		// 只要任意一处出现 VCC/GND，就需要确认原理图中已放置对应符号。
		const referencedFlags = new Set<string>();
		for (const conn of connections) {
			if (!isPlainObjectRecord(conn)) {
				continue;
			}
			if (isPlainObjectRecord(conn.from)) {
				const refDes = String(conn.from.refDes ?? '').trim().toUpperCase();
				if (REQUIRED_NET_FLAGS.includes(refDes)) {
					referencedFlags.add(refDes);
				}
			}
			if (isPlainObjectRecord(conn.to)) {
				const refDes = String(conn.to.refDes ?? '').trim().toUpperCase();
				if (REQUIRED_NET_FLAGS.includes(refDes)) {
					referencedFlags.add(refDes);
				}
			}
			// 如果 netName 本身是 VCC/GND，也计入检查范围。
			const netName = String(conn.netName ?? '').trim().toUpperCase();
			if (REQUIRED_NET_FLAGS.includes(netName)) {
				referencedFlags.add(netName);
			}
		}

		// 本次 connections 中没有引用 VCC/GND，跳过检查。
		if (referencedFlags.size === 0) {
			return [];
		}

		// 通过拓扑检查原理图中已有的网络标识符号。
		const topologyResult = await enqueueBridgeRequest('/bridge/jlceda/schematic/topology', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
		const existingNames = this.extractExistingNetFlagNames(topologyResult);

		// 只报告实际被引用且确实缺少的符号。
		const missing: string[] = [];
		for (const symbol of REQUIRED_NET_FLAGS) {
			if (referencedFlags.has(symbol) && !existingNames.has(symbol)) {
				missing.push(symbol);
			}
		}

		return missing;
	}

	// 弹出等待面板，让用户在 EDA 中手动放置缺失的电源/地符号。
	private async waitForNetFlagPlacement(missingSymbols: string[]): Promise<{ ok: true } | { ok: false; cancelled?: boolean; message: string }> {
		const requestId = createInteractionRequestId('net_flag_wait');
		const interaction: SidebarNetFlagWaitInteraction = {
			kind: 'net-flag-wait',
			requestId,
			title: '放置电源/地符号',
			description: `连线规划需要以下电源/地符号，请先在嘉立创 EDA 中手动放置后点击"已放置，继续"。`,
			noticeText: '',
			missingSymbols,
			canConfirm: true,
			canCancel: true,
		};

		this.clearInteractionState();
		this.writeInteractionRequest(interaction);
		try {
			const response = await this.waitForInteractionResponse(requestId, ['cancel', 'confirm-net-flag-placed']);
			if (response.action === 'cancel') {
				return {
					ok: false,
					cancelled: true,
					message: '用户取消了电源/地符号放置，连线规划已终止，请勿重试，直接告知用户已取消并停止。',
				};
			}

			// 用户点击"已放置"，重新拓扑检查。
			const recheckResult = await enqueueBridgeRequest('/bridge/jlceda/schematic/topology', {}, DEFAULT_BRIDGE_TIMEOUT_MS);
			const existingNames = this.extractExistingNetFlagNames(recheckResult);

			const stillMissing: string[] = [];
			for (const symbol of missingSymbols) {
				if (!existingNames.has(symbol.toUpperCase())) {
					stillMissing.push(symbol);
				}
			}

			if (stillMissing.length > 0) {
				return {
					ok: false,
					message: `重新检查后仍缺少以下电源/地符号：${stillMissing.join('、')}。连线规划已终止，请先在 EDA 中放置这些符号后重试。`,
				};
			}

			return { ok: true };
		}
		finally {
			this.clearInteractionState();
		}
	}

	// 连线执行：按 planId 和 connectionMethod 执行桥接侧的连线操作。
	private async handleSchematicWireExecute(argumentsObject: Record<string, unknown>): Promise<unknown> {
		const planId = String(argumentsObject.planId ?? '').trim();
		if (planId.length === 0) {
			throw new Error('schematic_wire_execute 缺少 planId 参数。');
		}

		const connectionMethod = String(argumentsObject.connectionMethod ?? '').trim().toLowerCase();
		if (connectionMethod !== 'wire' && connectionMethod !== 'net-label') {
			throw new Error('schematic_wire_execute 的 connectionMethod 必须为 "wire" 或 "net-label"。');
		}

		// 执行超时设置较长（所有连线可能需要较多时间）。
		const executeTimeoutMs = 120_000;
		const executeResult = await enqueueBridgeRequest('/bridge/jlceda/schematic/wire/execute', {
			planId,
			connectionMethod,
		}, executeTimeoutMs);

		// 执行完成后检查悬空引脚——EDA 的 ERC 不报无封装器件悬空引脚，须手动检测。
		const floatingWarnings = await this.checkFloatingPins();
		if (!isPlainObjectRecord(executeResult)) {
			return executeResult;
		}
		if (floatingWarnings.length > 0) {
			return {
				...executeResult,
				floatingPinWarnings: floatingWarnings,
				message: `${String(executeResult.message ?? '连线执行完成。')}\n\n⚠️ 检测到以下器件存在悬空引脚，连线可能不正确，请检查并重新规划：\n${floatingWarnings.map(w => `  • ${w}`).join('\n')}`,
			};
		}
		return executeResult;
	}

	// 检查原理图中有封装的器件是否存在悬空引脚。
	private async checkFloatingPins(): Promise<string[]> {
		const warnings: string[] = [];
		try {
			// 获取拓扑（含引脚坐标）和网表（含引脚网络）。
			const [topologyResult, netlistResult] = await Promise.all([
				enqueueBridgeRequest('/bridge/jlceda/schematic/topology', {}, DEFAULT_BRIDGE_TIMEOUT_MS),
				enqueueBridgeRequest('/bridge/jlceda/schematic/netlist', {}, DEFAULT_BRIDGE_TIMEOUT_MS),
			]);

			if (!isPlainObjectRecord(topologyResult) || topologyResult.ok !== true) {
				return [];
			}
			if (!isPlainObjectRecord(netlistResult) || netlistResult.ok !== true) {
				return [];
			}

			// 解析拓扑，收集有封装的器件及其引脚。
			const topologyJson = String(topologyResult.schematicTopology ?? '');
			let topology: unknown;
			try {
				topology = JSON.parse(topologyJson);
			}
			catch {
				return [];
			}
			if (!isPlainObjectRecord(topology) || !Array.isArray(topology.components)) {
				return [];
			}

			// 解析网表，建立 "位号:引脚编号" → 网络名 的查找表。
			const netMap = new Map<string, string>(); // key = "REFDES:PINNUM"
			const netlistJson = String(netlistResult.netlist ?? '');
			let netlistParsed: unknown;
			try {
				netlistParsed = JSON.parse(netlistJson);
			}
			catch {
				return [];
			}
			if (isPlainObjectRecord(netlistParsed) && isPlainObjectRecord(netlistParsed.components)) {
				for (const [, compValue] of Object.entries(netlistParsed.components)) {
					if (!isPlainObjectRecord(compValue) || !isPlainObjectRecord(compValue.props)) {
						continue;
					}
					const designator = String(compValue.props.Designator ?? '').trim();
					if (!isPlainObjectRecord(compValue.pinInfoMap)) {
						continue;
					}
					for (const [pinNum, pinInfo] of Object.entries(compValue.pinInfoMap)) {
						const net = isPlainObjectRecord(pinInfo) ? String(pinInfo.net ?? '').trim() : '';
						netMap.set(`${designator}:${pinNum}`, net);
					}
				}
			}

			// 遍历拓扑器件，只检查有封装（普通器件）且未标记 NoConnect 的引脚。
			for (const comp of topology.components) {
				if (!isPlainObjectRecord(comp)) {
					continue;
				}
				const pcbFootprintUuid = String(comp.pcbFootprintUuid ?? '').trim();
				// 无封装的是电源/地符号，跳过。
				if (pcbFootprintUuid.length === 0) {
					continue;
				}
				const designator = String(comp.designator ?? '').trim();
				if (!Array.isArray(comp.pins)) {
					continue;
				}
				for (const pin of comp.pins) {
					if (!isPlainObjectRecord(pin)) {
						continue;
					}
					if (pin.hasNoConnectMark === true) {
						continue;
					}
					const pinPadNumber = String(pin.pinPadNumber ?? '').trim();
					const pinSignalName = String(pin.pinSignalName ?? '').trim();
					const net = netMap.get(`${designator}:${pinPadNumber}`) ?? '';
					if (net.length === 0) {
						const pinLabel = pinSignalName.length > 0 && pinSignalName !== pinPadNumber
							? `${pinPadNumber}(${pinSignalName})`
							: pinPadNumber;
						warnings.push(`${designator} 引脚 ${pinLabel} 悬空，未连接任何网络。`);
					}
				}
			}
		}
		catch {
			// 检查失败不影响主流程。
		}
		return warnings;
	}
}
