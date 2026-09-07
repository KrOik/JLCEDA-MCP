import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponseStore, compactResult } from './response-store';
import { CandidateStore } from './candidate-store';
afterEach(() => vi.useRealTimers());
describe('bounded session-local snapshots and references', () => {
  it('substantially reduces serialized placement responses without dropping placed IDs', () => {
    const raw = { ok: true, remainingIndices: [], results: Array.from({ length: 20 }, (_, index) => ({ index, ok: true, executionState: 'confirmed', primitiveId: `part-${index}`, designator: `R${index}`, x: index * 100, y: 0, uuid: 'u'.repeat(32), libraryUuid: 'l'.repeat(32), nets: { 1: 'GND' }, geometry: { box: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }, collisionChecked: true })) };
    const compact = compactResult('component_place', raw) as any;
    const before = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(raw, null, 2) }], structuredContent: raw }).length;
    const after = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(compact) }] }).length;
    expect(after).toBeLessThan(before * 0.5);
    expect(compact.results.map((r: any) => r.primitiveId)).toEqual(raw.results.map(r => r.primitiveId));
  });
  it('returns stable refs, supports lossless paging, and isolates sessions', () => {
    const store = new ResponseStore();
    const raw = { lines: Array.from({ length: 30 }, (_, i) => ({ id: i, net: 'GND' })) };
    const ref = store.save(raw)!;
    expect(store.save(raw)).toBe(ref);
    let text = ''; let offset: number | null = 0;
    while (offset !== null) { const page = store.read({ resultRef: ref, offset, limit: 100 }) as any; text += page.text; offset = page.nextOffset; }
    expect(JSON.parse(text)).toEqual(raw);
    expect(new ResponseStore().read({ resultRef: ref })).toMatchObject({ errorCode: 'RESULT_EXPIRED' });
  });
  it('keeps actionable placement failures while dropping successful input echoes', () => {
    const failure = { ok: false, primitiveId: 'bad', stagedId: 'temp', cleanedUp: false, error: 'collision', suggestedPosition: { x: 0, y: 20 } };
    const compact = compactResult('component_place', { ok: false, results: [{ ok: true, primitiveId: 'done', uuid: 'long', libraryUuid: 'long' }, failure], remainingIndices: [1, 2] }) as any;
    expect(compact.results[1]).toEqual(failure);
    expect(compact.remainingIndices).toEqual([1, 2]); expect(compact.results[0]).not.toHaveProperty('libraryUuid');
  });
  it('resolves only registered candidates, preserves explicit constraints and expires', () => {
    vi.useFakeTimers(); const store = new CandidateStore();
    const ref = store.register({ uuid: 'u', libraryUuid: 'l' });
    expect(store.register({ uuid: 'u', libraryUuid: 'l' })).toBe(ref);
    expect(store.expand([{ candidateRef: ref, group: 'power', nets: { 1: 'VCC' } }])).toEqual([{ uuid: 'u', libraryUuid: 'l', group: 'power', nets: { 1: 'VCC' } }]);
    expect(() => store.expand([{ candidateRef: ref, uuid: 'other' }])).toThrow('CANDIDATE_MISMATCH');
    expect(() => new CandidateStore().expand([{ candidateRef: ref }])).toThrow('CANDIDATE_EXPIRED');
    vi.advanceTimersByTime(1800001); expect(() => store.expand([{ candidateRef: ref }])).toThrow('CANDIDATE_EXPIRED');
  });
});
