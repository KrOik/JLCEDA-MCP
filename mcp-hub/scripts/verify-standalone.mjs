import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const httpPort = await freePort();
let bridgePort = await freePort();
while (bridgePort === httpPort) bridgePort = await freePort();
const base = `http://127.0.0.1:${httpPort}`;
const env = { ...process.env, JLCEDA_HTTP_PORT: String(httpPort), JLCEDA_BRIDGE_PORT: String(bridgePort) };
const clients = [];
function cli(command, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('scripts/service.mjs'), command], { env, windowsHide: true, stdio: 'pipe' });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolvePromise(stdout) : reject(new Error(stderr || stdout)));
    child.stdin.end(input);
  });
}
async function rpc(name, args = {}) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(5000) });
  return await response.json();
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for expected state');
}
async function peer(clientId, documentType) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridgePort}/bridge/ws`);
  const tasks = [];
  clients.push(socket);
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === 'bridge/task') tasks.push(message);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const send = message => socket.send(JSON.stringify({ clientId, ...message }));
  send({ type: 'bridge/hello', bridgeVersion: '1.5.5' });
  send({ type: 'bridge/ready', readyAt: Date.now() });
  send({ type: 'bridge/heartbeat', sentAt: Date.now(), context: { documentUuid: `${clientId}-doc`, documentType, title: clientId } });
  return { tasks, send };
}

try {
  const started = await Promise.all(Array.from({ length: 4 }, () => cli('start').then(JSON.parse)));
  assert.equal(new Set(started.map(info => info.pid)).size, 1, 'Concurrent clients must share a single host');
  const initialized = await Promise.all(Array.from({ length: 3 }, () => cli('stdio', `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} })}\n`)));
  for (const output of initialized) assert.equal(JSON.parse(output).id, 2, 'stdout must contain only MCP JSON');
  const sch = await peer('sch', 'schematic');
  await peer('pcb', 'pcb');
  await until(async () => (await (await fetch(`${base}/status`)).json()).clients?.every(peer => peer.context) && (await (await fetch(`${base}/status`)).json()).clients.length === 2);
  assert.equal((await rpc('component_select', { keyword: 'C123' })).result.structuredContent.errorCode, 'TARGET_REQUIRED');
  assert.equal((await rpc('component_place', { targetClientId: 'pcb', targetDocumentUuid: 'pcb-doc', components: [] })).result.structuredContent.errorCode, 'DOCUMENT_TYPE_MISMATCH');
  const selected = rpc('component_select', { targetClientId: 'sch', targetDocumentUuid: 'sch-doc', keyword: 'C123' });
  const task = await until(() => sch.tasks[0]);
  assert.equal(task.targetDocumentUuid, 'sch-doc');
  assert.ok(task.deadlineAt > Date.now());
  assert.equal((await rpc('component_select', { targetClientId: 'sch', keyword: 'C234' })).result.structuredContent.errorCode, 'BRIDGE_BUSY');
  sch.send({ type: 'bridge/result', requestId: task.requestId, leaseTerm: task.leaseTerm, result: { ok: true, candidates: [] } });
  assert.equal((await selected).result.structuredContent.ok, true);
  const slow = rpc('api_invoke', { targetClientId: 'sch', apiFullName: 'eda.test', timeoutMs: 1000 });
  const slowTask = await until(() => sch.tasks[1]);
  assert.equal((await slow).result.structuredContent.executionState, 'unknown');
  assert.equal((await rpc('component_select', { targetClientId: 'sch', keyword: 'C123' })).result.structuredContent.errorCode, 'EXECUTION_UNCERTAIN');
  sch.send({ type: 'bridge/result', requestId: slowTask.requestId, leaseTerm: slowTask.leaseTerm, result: { ok: true, primitiveId: 'late-created-id' } });
  await until(async () => (await (await fetch(`${base}/status`)).json()).clients.find(peer => peer.clientId === 'sch')?.lastExecution?.result?.primitiveId === 'late-created-id');
  console.log('PASS: singleton startup, multiple stdio clients, clean stdout, explicit page routing, type rejection, busy feedback, timeout quarantine, late-result recovery.');
} finally {
  for (const client of clients) client.terminate();
  await cli('stop');
}
