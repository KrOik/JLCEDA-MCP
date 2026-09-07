/** Process-wide upstream pressure control, shared by all MCP sessions. */
export class SearchCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<unknown>>();
  private cache = new Map<string, { expires: number; value: unknown }>();
  private nextStart = 0;
  private cooldownUntil = 0;
  constructor(private intervalMs = 1000, private ttlMs = 600000, private maxPending = 8) {}

  async run(key: string, fetch: () => Promise<unknown>): Promise<unknown> {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    this.cache.delete(key);
    const pending = this.pending.get(key);
    if (pending) return structuredClone(await pending);
    if (this.cooldownUntil > Date.now()) return this.limited();
    if (this.pending.size >= this.maxPending) return { ok: false, errorCode: 'SEARCH_QUEUE_FULL', retryAfterMs: this.intervalMs * this.maxPending };
    const queuedAt = Date.now();
    const promise = this.tail.catch(() => undefined).then(async () => {
      if (this.cooldownUntil > Date.now()) return this.limited();
      if (Date.now() - queuedAt > 20000) return { ok: false, errorCode: 'SEARCH_QUEUE_TIMEOUT', retryAfterMs: this.intervalMs };
      const delay = Math.max(0, this.nextStart - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      this.nextStart = Date.now() + this.intervalMs;
      let value: unknown;
      try { value = await fetch(); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/429|rate.?limit|too many requests/i.test(message)) throw error;
        value = { ok: false, errorCode: 'RATE_LIMITED', retryAfterMs: 60000 };
      }
      const record = value as Record<string, unknown> | null;
      const nested = record?.result as { status?: number; code?: number; message?: string } | undefined;
      if (record && (record.errorCode === 'RATE_LIMITED' || nested?.status === 429 || nested?.code === 429 || /429|too many requests/i.test(String(record.error ?? nested?.message ?? '')))) {
        const retry = typeof record.retryAfterMs === 'number' && Number.isFinite(record.retryAfterMs) ? Math.max(1000, record.retryAfterMs) : 60000;
        this.cooldownUntil = Date.now() + retry;
        return this.limited();
      }
      if (record?.ok === true || record?.errorCode === 'NO_MATCH') {
        for (const [k, entry] of this.cache) if (entry.expires <= Date.now()) this.cache.delete(k);
        if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { value: structuredClone(value), expires: Date.now() + (record.ok ? this.ttlMs : 60000) });
      }
      return value;
    });
    this.pending.set(key, promise);
    this.tail = promise;
    try { return structuredClone(await promise); }
    finally { this.pending.delete(key); }
  }

  private limited() { return { ok: false, errorCode: 'RATE_LIMITED', retryAfterMs: Math.max(0, this.cooldownUntil - Date.now()) }; }
}

export const componentSearchCoordinator = new SearchCoordinator();
