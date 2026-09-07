/** One shared HTTP host; each MCP stdio client is only a lightweight proxy. */
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'stdio';
const arg = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const httpPort = Number(arg('--http-port') ?? process.env.JLCEDA_HTTP_PORT ?? 7655);
const bridgePort = Number(arg('--port') ?? process.env.JLCEDA_BRIDGE_PORT ?? 8765);
for (const port of [httpPort, bridgePort]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid service port');
}
const base = `http://127.0.0.1:${httpPort}`;
const rawToolNames = new Set(['api_index', 'api_search', 'api_invoke', 'eda_context']);
const exposeRaw = process.argv.includes('--expose-raw-api-tools');
const instructions = Buffer.from(arg('--agent-instructions') ?? '', 'base64').toString('utf8');

async function status() {
  let response;
  try { response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(1500) }); }
  catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return undefined;
    throw error;
  }
  if (!response.ok) throw new Error(`端口 ${httpPort} 已被非独立服务占用；请停止旧 Hub 或更换端口`);
  const info = await response.json();
  if (info.service !== 'jlceda-mcp-standalone' || info.bridgePort !== bridgePort) throw new Error('服务身份或桥接端口不匹配');
  return info;
}

async function ensureService() {
  const existing = await status();
  if (existing) return existing;
  // OS listening sockets arbitrate simultaneous launches; only one host can bind.
  const logPath = join(tmpdir(), `jlceda-mcp-${httpPort}.log`);
  const log = openSync(logPath, 'a');
  try {
    const child = spawn(process.execPath, [join(root, 'out/server/standalone.js'), '--port', String(bridgePort), '--http-port', String(httpPort)],
      { detached: true, windowsHide: true, stdio: ['ignore', log, log], cwd: root });
    child.on('error', error => console.error(error.message));
    child.unref();
  } finally { closeSync(log); }
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const info = await status();
    if (info) return info;
  }
  throw new Error(`服务启动失败，请查看 ${logPath}；检查旧 VS Code Hub 是否占用 ${bridgePort}`);
}

try {
  if (command === 'status') {
    console.log(JSON.stringify(await status() ?? { online: false }, null, 2));
  } else if (command === 'stop') {
    if (!await status()) console.log('服务未运行');
    else {
      const response = await fetch(`${base}/control/stop`, { method: 'POST', headers: { 'X-JLCEDA-Control': 'stop' }, signal: AbortSignal.timeout(3000) });
      const result = await response.json();
      console.log(JSON.stringify(result));
      if (!response.ok) process.exitCode = 1;
    }
  } else if (command === 'start') {
    console.log(JSON.stringify(await ensureService(), null, 2));
  } else if (command === 'stdio') {
    await ensureService();
    const reader = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });
    // Independent requests: a long tools/call must not block ping or tools/list.
    reader.on('line', line => {
      void (async () => {
        let request;
        try {
          request = JSON.parse(line);
          if (!exposeRaw && request.method === 'tools/call' && rawToolNames.has(request.params?.name)) throw new Error('此客户端未启用透传 API 工具');
          await ensureService();
          const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: line, signal: AbortSignal.timeout(135000) });
          if (response.status === 202 || response.status === 204) return;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body = await response.text();
          if (!body.trim()) return;
          const result = JSON.parse(body);
          if (request.method === 'tools/list' && !exposeRaw && result.result?.tools) result.result.tools = result.result.tools.filter(tool => !rawToolNames.has(tool.name));
          if (request.method === 'initialize' && instructions && result.result) result.result.instructions = `${result.result.instructions ?? ''}\n\n${instructions}`;
          process.stdout.write(`${JSON.stringify(result)}\n`);
        } catch (error) {
          if (request?.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id,
            error: { code: -32000, message: `${error.message}; 执行结果可能未知，不要自动重试写操作。` } })}\n`);
          else console.error(error.message);
        }
      })();
    });
  } else {
    throw new Error('Usage: node scripts/service.mjs start|status|stop|stdio');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
