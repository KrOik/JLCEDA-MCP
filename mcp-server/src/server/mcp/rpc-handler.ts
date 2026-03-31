/**
 * ------------------------------------------------------------------------
 * 名称：JSON-RPC 处理器
 * 说明：处理 stdio JSON-RPC 请求并分发 MCP 工具调用。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅处理协议，不直接处理桥接网络。
 * ------------------------------------------------------------------------
 */

import type { ToolDispatcher } from './tool-dispatcher';
import { isPlainObjectRecord, toSafeErrorMessage } from '../../utils';
import _defaultInstructions from '../../data/agent-instructions.md';
import { waitForBridgeReady } from '../bridge/broker';

const DEFAULT_AGENT_INSTRUCTIONS = _defaultInstructions.trimEnd();

// 工具调用等待桥接就绪的最长时间（毫秒）。
// 该值需覆盖 Bridge 侧空闲检测超时（5s）+ 重连间隔（1.2s）+ 连接握手的最坏时序。
const BRIDGE_READY_TIMEOUT_MS = 10000;

interface RpcRequest {
	jsonrpc: '2.0';
	id?: string | number;
	method: string;
	params?: unknown;
}

export interface RpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: {
		code: number;
		message: string;
	};
}

export class RpcHandler {
	public constructor(
		private readonly toolDispatcher: ToolDispatcher,
		private readonly serverVersion: string,
		private readonly agentInstructions?: string,
	) {}

	/**
	 * 解析 JSON-RPC 请求。
	 * @param body 原始文本。
	 * @returns 请求对象。
	 */
	public parseRequestBody(body: string): RpcRequest {
		const parsed = JSON.parse(body) as RpcRequest;
		if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
			throw new Error('无效 JSON-RPC 请求。');
		}
		return parsed;
	}

	/**
	 * 处理 JSON-RPC 请求。
	 * @param payload 请求对象。
	 * @returns 响应对象或 null。
	 */
	public async handleRequest(payload: RpcRequest): Promise<RpcResponse | null> {
		const requestId = payload.id ?? null;
		const needsResponse = payload.id !== undefined;

		if (payload.method === 'initialize') {
			if (!needsResponse) {
				return null;
			}
			const customPart = this.agentInstructions ? this.agentInstructions.trim() : '';
			const instructions = customPart.length > 0
				? `${DEFAULT_AGENT_INSTRUCTIONS}\n\n${customPart}`
				: DEFAULT_AGENT_INSTRUCTIONS;
			return this.createSuccessResponse(requestId, {
				protocolVersion: '2024-11-05',
				capabilities: { tools: {} },
				instructions,
				serverInfo: {
					name: 'jlceda-mcp-hub',
					version: this.serverVersion,
				},
			});
		}

		if (payload.method === 'notifications/initialized') {
			return null;
		}

		if (payload.method === 'tools/list') {
			if (!needsResponse) {
				return null;
			}
			return this.createSuccessResponse(requestId, {
				tools: this.toolDispatcher.getToolDefinitions(),
			});
		}

		if (payload.method === 'tools/call') {
			if (!isPlainObjectRecord(payload.params)) {
				return needsResponse ? this.createErrorResponse(requestId, -32602, 'tools/call 参数必须是对象。') : null;
			}

			const toolName = String(payload.params.name ?? '').trim();
			if (toolName.length === 0) {
				return needsResponse ? this.createErrorResponse(requestId, -32602, 'tools/call 缺少 name 参数。') : null;
			}

			// 等待桥接活动客户端就绪，最多等待 BRIDGE_READY_TIMEOUT_MS 毫秒。
			try {
				await waitForBridgeReady(BRIDGE_READY_TIMEOUT_MS);
			}
			catch (bridgeError: unknown) {
				return needsResponse
					? this.createErrorResponse(requestId, -32000, toSafeErrorMessage(bridgeError))
					: null;
			}

			try {
				const result = await this.toolDispatcher.dispatch({
					name: toolName,
					arguments: isPlainObjectRecord(payload.params.arguments) ? payload.params.arguments : undefined,
				});
				return needsResponse ? this.createSuccessResponse(requestId, result) : null;
			}
			catch (error: unknown) {
				return needsResponse ? this.createErrorResponse(requestId, -32000, toSafeErrorMessage(error)) : null;
			}
		}

		return needsResponse ? this.createErrorResponse(requestId, -32601, `不支持的方法: ${payload.method}`) : null;
	}

	/**
	 * 创建成功响应。
	 * @param id 请求 ID。
	 * @param result 返回结果。
	 * @returns JSON-RPC 响应。
	 */
	public createSuccessResponse(id: string | number | null, result: unknown): RpcResponse {
		return {
			jsonrpc: '2.0',
			id,
			result,
		};
	}

	/**
	 * 创建错误响应。
	 * @param id 请求 ID。
	 * @param code 错误码。
	 * @param message 错误消息。
	 * @returns JSON-RPC 响应。
	 */
	public createErrorResponse(id: string | number | null, code: number, message: string): RpcResponse {
		return {
			jsonrpc: '2.0',
			id,
			error: {
				code,
				message,
			},
		};
	}
}
