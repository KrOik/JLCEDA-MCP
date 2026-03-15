/**
 * ------------------------------------------------------------------------
 * 名称：桥接 WebSocket 服务封装
 * 说明：负责创建、监听并关闭桥接 WebSocket 服务实例。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅封装网络监听，不承载桥接仲裁逻辑。
 * ------------------------------------------------------------------------
 */

import { WebSocketServer, type WebSocket } from 'ws';

export interface BridgeWebSocketServerOptions {
	host: string;
	port: number;
	path: string;
	onConnection: (socket: WebSocket) => void;
	onListening: () => void;
	onError: (error: Error) => void;
}

export interface BridgeWebSocketServer {
	server: WebSocketServer;
	close: () => Promise<void>;
}

/**
 * 启动桥接 WebSocket 服务。
 * @param options 启动配置。
 * @returns 已启动的服务封装对象。
 */
export function startBridgeWebSocketServer(options: BridgeWebSocketServerOptions): BridgeWebSocketServer {
	const server = new WebSocketServer({
		host: options.host,
		port: options.port,
		path: options.path,
	});

	server.on('connection', (socket: WebSocket) => {
		options.onConnection(socket);
	});

	server.on('listening', () => {
		options.onListening();
	});

	server.on('error', (error: Error) => {
		options.onError(error);
	});

	return {
		server,
		close: async () => {
			await new Promise<void>((resolve) => {
				server.close(() => {
					resolve();
				});
			});
		},
	};
}
