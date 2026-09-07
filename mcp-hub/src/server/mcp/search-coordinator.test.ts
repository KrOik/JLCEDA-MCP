import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchCoordinator } from './search-coordinator';

afterEach(() => vi.useRealTimers());
describe('shared search pressure control', () => {
  it('coalesces concurrent duplicates, caches results, and isolates returned objects', async () => {
    const gate = new SearchCoordinator(0);
    const fetch = vi.fn(async () => ({ ok: true, candidates: ['a'] }));
    const [a, b] = await Promise.all([gate.run('same', fetch), gate.run('same', fetch)]) as any[];
    a.candidates.push('mutation');
    expect(b.candidates).toEqual(['a']);
    expect(await gate.run('same', fetch)).toEqual({ ok: true, candidates: ['a'] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('serializes distinct requests and spaces upstream starts', async () => {
    vi.useFakeTimers();
    const gate = new SearchCoordinator(1000);
    const starts: number[] = [];
    const fetch = vi.fn(async () => { starts.push(Date.now()); await new Promise(r => setTimeout(r, 100)); return { ok: true }; });
    const pending = Promise.all(['a', 'b', 'c'].map(key => gate.run(key, fetch)));
    await vi.runAllTimersAsync(); await pending;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
  });
  it('honors 429 cooldown across different keys without automatic retry', async () => {
    vi.useFakeTimers();
    const gate = new SearchCoordinator(0);
    const fetch = vi.fn(async () => ({ ok: false, errorCode: 'RATE_LIMITED', retryAfterMs: 120000 }));
    expect(await gate.run('a', fetch)).toMatchObject({ errorCode: 'RATE_LIMITED', retryAfterMs: 120000 });
    expect(await gate.run('b', fetch)).toMatchObject({ errorCode: 'RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);
    await gate.run('b', fetch); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('bounds the queue and expires negative cache', async () => {
    vi.useFakeTimers();
    const gate = new SearchCoordinator(1000, 600000, 1);
    const fetch = vi.fn(async () => ({ ok: false, errorCode: 'NO_MATCH' }));
    const first = gate.run('a', fetch);
    expect(await gate.run('b', fetch)).toMatchObject({ errorCode: 'SEARCH_QUEUE_FULL' });
    await first; await gate.run('a', fetch); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60001);
    await gate.run('a', fetch); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
