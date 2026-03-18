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
import { isPlainObjectRecord, parseBoundedIntegerValue } from '../../utils';
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

const TOOL_DEFINITIONS = loadToolDefinitions();

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
	return definitions;
}

export class ToolDispatcher {
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
		if (toolCallParams.name === 'jlceda_api_search') {
			return this.toToolContent(await this.handleApiSearch(args));
		}
		if (toolCallParams.name === 'jlceda_api_invoke') {
			return this.toToolContent(await this.handleApiInvoke(args));
		}
		if (toolCallParams.name === 'jlceda_context_get') {
			return this.toToolContent(await this.handleContextGet(args));
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
		const invokeArgs = isPlainObjectRecord(argumentsObject.args) ? argumentsObject.args : {};
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
}
