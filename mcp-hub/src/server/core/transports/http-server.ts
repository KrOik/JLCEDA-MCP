/**
 * ------------------------------------------------------------------------
 * 名称：HTTP MCP 传输层
 * 说明：实现 MCP Streamable HTTP 传输，供第三方客户端（如 Claude Code、Codex）使用。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-28
 * 备注：仅监听本机回环地址，不对外暴露。POST /mcp 处理 JSON-RPC 请求。
 * ------------------------------------------------------------------------
 */

import * as http from 'http';
import type { RpcHandler } from '../../mcp/rpc-handler';
import { toSafeErrorMessage } from '../../../utils';

// HTTP 请求体最大长度（字节），防止超大请求体占满内存。
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpMcpServerOptions {
	port: number;
	rpcHandler: RpcHandler;
	onListening: () => void;
	onError: (error: Error) => void;
}

export interface HttpMcpServer {
	close: () => Promise<void>;
}

// 将 JSON-RPC 响应写回 HTTP 响应。
function writeJsonResponse(res: http.ServerResponse, statusCode: number, body: unknown): void {
	const payload = JSON.stringify(body);
	const byteLength = Buffer.byteLength(payload, 'utf8');
	res.writeHead(statusCode, {
		'Content-Type': 'application/json',
		'Content-Length': byteLength,
	});
	res.end(payload);
}

/**
 * 启动 HTTP MCP 服务器。
 * @param options 启动配置。
 * @returns 已启动的服务封装对象。
 */
export function startHttpMcpServer(options: HttpMcpServerOptions): HttpMcpServer {
	const server = http.createServer((req, res) => {
		// 健康检查端点，供外部工具探活。
		if (req.method === 'GET' && req.url === '/health') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('ok');
			return;
		}

		// MCP Streamable HTTP 传输端点。
		if (req.method === 'POST' && req.url === '/mcp') {
			const chunks: Buffer[] = [];
			let totalBytes = 0;

			req.on('data', (chunk: Buffer) => {
				totalBytes += chunk.byteLength;
				if (totalBytes > MAX_BODY_BYTES) {
					res.writeHead(413, { 'Content-Type': 'text/plain' });
					res.end('Request body too large');
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});

			req.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf8');
				void (async () => {
					try {
						const request = options.rpcHandler.parseRequestBody(body);
						const response = await options.rpcHandler.handleRequest(request);
						if (response === null) {
							// 通知型消息（无 id），返回 202 空响应。
							res.writeHead(202);
							res.end();
						} else {
							writeJsonResponse(res, 200, response);
						}
					} catch (error: unknown) {
						const errorResponse = options.rpcHandler.createErrorResponse(
							null, -32700, toSafeErrorMessage(error)
						);
						writeJsonResponse(res, 200, errorResponse);
					}
				})();
			});

			req.on('error', (error) => {
				if (!res.headersSent) {
					const errorResponse = options.rpcHandler.createErrorResponse(
						null, -32700, toSafeErrorMessage(error)
					);
					writeJsonResponse(res, 200, errorResponse);
				}
			});

			return;
		}

		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('Not Found');
	});

	// 仅监听本机回环地址，不对外暴露。
	server.listen(options.port, '127.0.0.1', () => {
		options.onListening();
	});

	server.on('error', (error: Error) => {
		options.onError(error);
	});

	return {
		close: () => new Promise<void>((resolve) => {
			server.close(() => {
				resolve();
			});
		}),
	};
}
