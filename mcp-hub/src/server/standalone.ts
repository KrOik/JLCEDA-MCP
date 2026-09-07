/** Production MCP host with no VS Code imports or host IPC dependency. */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { attachBridgeClientSocket, getBridgeStatus, notifyBridgeClientsDisconnect, pumpBridgeBroker, setServerVersion } from './bridge/broker';
import { startBridgeWebSocketServer } from './core/transports/bridge-server';
import { startHttpMcpServer } from './core/transports/http-server';
import type { HttpMcpServer } from './core/transports/http-server';
import { createStdioLineTransport } from './core/transports/line-transport';
import { RpcHandler } from './mcp/rpc-handler';
import { ToolDispatcher } from './mcp/tool-dispatcher';
import { version } from '../../package.json';

function port(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${flag}`);
  return value;
}

async function main(): Promise<void> {
  const bridgePort = port('--port', 8765);
  const httpPort = port('--http-port', 7655);
  const stdio = process.argv.includes('--stdio');
  if (bridgePort === httpPort) throw new Error('Bridge and HTTP ports must differ');
  setServerVersion(version);
  const dispatcher = new ToolDispatcher(tmpdir(), randomUUID(), true);
  const rpcHandler = new RpcHandler(dispatcher, version);
  let stopping = false;
  let http: HttpMcpServer | undefined;
  const fail = (error: Error): void => {
    console.error(error.message);
    void shutdown(1);
  };
  const bridge = startBridgeWebSocketServer({
    host: '127.0.0.1', port: bridgePort, path: '/bridge/ws',
    onConnection: attachBridgeClientSocket,
    onListening: () => console.error(`Bridge ws://127.0.0.1:${bridgePort}/bridge/ws`), onError: fail,
  });
  await once(bridge.server, 'listening');
  http = startHttpMcpServer({ port: httpPort, rpcHandler,
    otaDirectory: resolve(process.env.JLCEDA_OTA_DIR || 'ota'),
    requestStop: () => {
      const status = getBridgeStatus();
      if (status.pendingRequests || status.clients.some(client => client.uncertainRequestId || client.context?.backgroundJob)) return false;
      setTimeout(() => { void shutdown(); }, 100);
      return true;
    },
    getStatus: () => ({ service: 'jlceda-mcp-standalone', version, pid: process.pid, bridgePort, httpPort, ...getBridgeStatus() }),
    onListening: () => console.error(`MCP http://127.0.0.1:${httpPort}/mcp`), onError: fail });
  async function shutdown(code = 0): Promise<void> {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(code), 3000);
    deadline.unref();
    await notifyBridgeClientsDisconnect('Standalone MCP shutting down');
    for (const client of bridge.server.clients) client.terminate();
    await Promise.allSettled([bridge.close(), http?.close()]);
    process.exit(code);
  }
  const pump = setInterval(() => { void pumpBridgeBroker().catch(fail); }, 1000);
  pump.unref();
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  if (stdio) {
    const transport = createStdioLineTransport(async line => {
      try {
        const response = await rpcHandler.handleRequest(rpcHandler.parseRequestBody(line));
        if (response) transport.write(response);
      } catch (error) {
        transport.write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(error) } });
      }
    });
    process.stdin.once('end', () => { void shutdown(); });
    transport.start();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
