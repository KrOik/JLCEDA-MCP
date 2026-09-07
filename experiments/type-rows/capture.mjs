// Read-only capture from the live MCP. Never creates, moves, or deletes EDA objects.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('./', import.meta.url));
let requestId = 0;
async function call(name, args = {}) {
  const response = await fetch('http://127.0.0.1:7655/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: { ...args, responseDetail: 'full' } } }),
    signal: AbortSignal.timeout(60000),
  });
  const rpc = await response.json();
  if (rpc.error) throw new Error(JSON.stringify(rpc.error));
  const result = rpc.result;
  if (result.isError) throw new Error(JSON.stringify(result));
  let data = result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text);
  if (data.detailOmitted && data.resultRef) {
    let offset = 0, text = '';
    do { const page = await call('result_read', { resultRef: data.resultRef, offset, limit: 12000 }); text += page.text; offset = page.nextOffset; } while (offset !== null);
    data = JSON.parse(text);
  }
  return data;
}
const invoke = async (apiFullName, args) => {
  if (!/\.(get|getAll|getAllPrimitiveId|getAllPinsByPrimitiveId|getPrimitivesBBox)$/.test(apiFullName)) throw new Error('Read-only API required');
  return (await call('api_invoke', { apiFullName, args })).result;
};
const normalize = b => b && ({ minX: Math.min(b.minX, b.maxX), maxX: Math.max(b.minX, b.maxX), minY: Math.min(b.minY, b.maxY), maxY: Math.max(b.minY, b.maxY) });
const status = await call('bridge_status');
if (status.connectedClients !== 1) throw new Error('Requires one unambiguous live page');
const snapshot = await call('schematic_read', { includeGeometry: true });
const parts = await invoke('eda.sch_PrimitiveComponent.getAll', ['part', false]);
for (const part of parts) {
  part.pins = await invoke('eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId', [part.primitiveId]);
  part.geometry = snapshot.geometry.find(g => g.primitiveId === part.primitiveId);
  part.attributes = (await invoke('eda.sch_PrimitiveAttribute.getAll', [part.primitiveId])).filter(a => a.keyVisible === true || a.valueVisible === true);
  for (const a of part.attributes) a.box = normalize(await invoke('eda.sch_Primitive.getPrimitivesBBox', [[a.primitiveId]]));
  console.log(`Captured ${part.designator}: ${part.pins.length} pins`);
}
const wires = await invoke('eda.sch_PrimitiveWire.getAll', []);
const wireIds = await invoke('eda.sch_PrimitiveWire.getAllPrimitiveId', []);
if (wireIds.length !== wires.length) throw new Error('Wire enumeration is incomplete');
for (const wire of wires) wire.box = normalize(await invoke('eda.sch_Primitive.getPrimitivesBBox', [[wire.primitiveId]]));
// Test whether native Wire NET text is exposed as an associated attribute.
const labelSamples = [];
for (const wire of wires.slice(0, 12)) {
  const attributes = await invoke('eda.sch_PrimitiveAttribute.getAll', [wire.primitiveId]);
  for (const a of attributes.filter(a => a.keyVisible === true || a.valueVisible === true)) {
    a.box = normalize(await invoke('eda.sch_Primitive.getPrimitivesBBox', [[a.primitiveId]]));
    labelSamples.push({ wireId: wire.primitiveId, net: wire.net, line: wire.line, attribute: a });
  }
}
const endStatus = await call('bridge_status');
if (JSON.stringify(status.clients[0].context) !== JSON.stringify(endStatus.clients[0].context)) throw new Error('Page changed during capture');
await mkdir(out, { recursive: true });
const review = await call('schematic_review');
await writeFile(`${out}live-fixture.json`, JSON.stringify({ capturedAt: new Date().toISOString(), context: status.clients[0].context, parts, wires, labelSamples, review, semantic: JSON.parse(snapshot.schematicCircuitSnapshot) }, null, 2));
console.log(JSON.stringify({ parts: parts.length, pins: parts.reduce((n, p) => n + p.pins.length, 0), wires: wires.length, labelSamples: labelSamples.length }));
