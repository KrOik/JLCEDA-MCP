/**
 * Lightweight runtime used by repository E2E automation.
 * It intentionally avoids VS Code host IPC while exercising the same HTTP MCP
 * transport, RPC handler, tool dispatcher, and bridge WebSocket broker path.
 */
import { attachBridgeClientSocket, notifyBridgeClientsDisconnect, setServerVersion } from './bridge/broker';
import { RpcHandler } from './mcp/rpc-handler';
import { ToolDispatcher } from './mcp/tool-dispatcher';
import { startBridgeWebSocketServer } from './core/transports/bridge-server';
import { startHttpMcpServer } from './core/transports/http-server';

const BRIDGE_WS_PATH = '/bridge/ws';

function getArgValue(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	if (index < 0 || index + 1 >= process.argv.length) {
		return undefined;
	}
	return process.argv[index + 1];
}

function getNumberArg(flag: string, fallback: number): number {
	const raw = getArgValue(flag);
	if (!raw) {
		return fallback;
	}
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
		throw new Error(`Invalid ${flag}: ${raw}`);
	}
	return parsed;
}

function getStringArg(flag: string, fallback: string): string {
	return String(getArgValue(flag) ?? fallback).trim() || fallback;
}

async function main(): Promise<void> {
	const host = getStringArg('--host', '127.0.0.1');
	const port = getNumberArg('--port', 8765);
	const httpPort = getNumberArg('--http-port', 7655);
	const storageDirectoryPath = getStringArg('--storage-directory', process.cwd());
	const sessionId = getStringArg('--session-id', 'e2e-runtime-lite');
	const extensionVersion = getStringArg('--extension-version', 'e2e');
	const exposeRawApiTools = getArgValue('--expose-raw-api-tools') === '1';
	const agentInstructionsB64 = getArgValue('--agent-instructions') ?? '';
	const agentInstructions = agentInstructionsB64.length > 0
		? Buffer.from(agentInstructionsB64, 'base64').toString('utf8')
		: '';

	setServerVersion(extensionVersion);
	const toolDispatcher = new ToolDispatcher(storageDirectoryPath, sessionId, exposeRawApiTools);
	const rpcHandler = new RpcHandler(toolDispatcher, extensionVersion, agentInstructions);
	const bridgeServer = startBridgeWebSocketServer({
		host,
		port,
		path: BRIDGE_WS_PATH,
		onConnection: socket => attachBridgeClientSocket(socket),
		onListening: () => console.log(`bridge listening ws://${host}:${port}${BRIDGE_WS_PATH}`),
		onError: (error) => {
			console.error(error);
			process.exitCode = 1;
		},
	});
	const httpServer = startHttpMcpServer({
		port: httpPort,
		rpcHandler,
		onListening: () => console.log(`http listening http://127.0.0.1:${httpPort}/mcp`),
		onError: (error) => {
			console.error(error);
			process.exitCode = 1;
		},
	});

	async function shutdown(exitCode = 0): Promise<void> {
		await notifyBridgeClientsDisconnect('E2E runtime shutting down.');
		for (const client of bridgeServer.server.clients) {
			client.close(1001, 'E2E runtime shutting down.');
		}
		await bridgeServer.close();
		await httpServer.close();
		process.exit(exitCode);
	}

	process.on('SIGTERM', () => { void shutdown(); });
	process.on('SIGINT', () => { void shutdown(); });
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
