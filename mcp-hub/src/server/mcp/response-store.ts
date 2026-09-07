import { createHash, randomBytes } from 'node:crypto';
import { isPlainObjectRecord } from '../../utils';

/** Session-local, bounded detail snapshots. Reading never replays an EDA operation. */
export class ResponseStore {
  private salt = randomBytes(16).toString('hex');
  private entries = new Map<string, { text: string; expires: number }>();
  private bytes = 0;
  save(value: unknown): string | undefined {
    const text = JSON.stringify(value) ?? 'null';
    if (text.length > 2000000) return undefined;
    const id = createHash('sha256').update(this.salt).update(text).digest('hex').slice(0, 20);
    const existing = this.entries.get(id);
    if (existing && existing.expires > Date.now()) return id;
    for (const [id, entry] of this.entries) if (entry.expires <= Date.now()) this.remove(id);
    while (this.entries.size >= 32 || this.bytes + text.length > 4000000) this.remove(this.entries.keys().next().value!);
    this.entries.set(id, { text, expires: Date.now() + 1800000 }); this.bytes += text.length;
    return id;
  }
  read(args: Record<string, unknown>) {
    const id = String(args.resultRef ?? ''); const entry = this.entries.get(id);
    if (!entry || entry.expires <= Date.now()) { if (entry) this.remove(id); return { ok: false, errorCode: 'RESULT_EXPIRED' }; }
    const offset = args.offset ?? 0; const limit = args.limit ?? 6000;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > entry.text.length || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 12000) throw new Error('offset/limit 非法');
    const end = Math.min(entry.text.length, offset + limit);
    return { ok: true, resultRef: id, offset, totalChars: entry.text.length, text: entry.text.slice(offset, end), nextOffset: end < entry.text.length ? end : null };
  }
  private remove(id: string) { const entry = this.entries.get(id); if (entry) this.bytes -= entry.text.length; this.entries.delete(id); }
}

export function compactResult(tool: string, value: unknown): unknown {
  if (!isPlainObjectRecord(value)) return value;
  if (tool === 'bridge_status' && Array.isArray(value.clients)) {
    return { connectedClients: value.connectedClients, pendingRequests: value.pendingRequests, clients: value.clients.map(client => {
      const { clientId, context, ready, active, lastExecution } = client;
      return { clientId, context, ready, active, ...(lastExecution ? { lastExecution: { requestId: lastExecution.requestId, state: lastExecution.state, error: lastExecution.error } } : {}) };
    }) };
  }
  if (tool === 'component_place' && value.dryRun !== true && Array.isArray(value.results)) {
    const out = { ...value };
    delete out.groups;
    out.results = value.results.map(item => item.ok === true ? { index: item.index, primitiveId: item.primitiveId, designator: item.designator, x: item.x, y: item.y, ok: true, executionState: item.executionState } : item);
    if (isPlainObjectRecord(out.connections) && out.connections.ok === true) out.connections = { ok: true, attempted: out.connections.attempted };
    return out;
  }
  return value;
}
