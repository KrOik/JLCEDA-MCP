import { describe, expect, it } from 'vitest';
import { parseRelayoutRequest } from './schematic-relayout-handler';

describe('schematic relayout request', () => {
	it('is preview-first and supports measured compact / ELK plans', () => {
		expect(parseRelayoutRequest({})).toMatchObject({ apply: false, options: { mode: 'compact', grid: 10 } });
		expect(parseRelayoutRequest({ apply: true, layout: { mode: 'elk' }, componentIds: ['a', 'b'] })).toMatchObject({ apply: true, componentIds: ['a', 'b'], options: { mode: 'elk' } });
	});

	it('refuses unsafe grid and invalid layout bounds before EDA writes', () => {
		expect(() => parseRelayoutRequest({ layout: { mode: 'grid' } })).toThrow('仅支持 compact/elk');
		expect(() => parseRelayoutRequest({ clearance: 1 })).toThrow('布局约束非法');
		expect(() => parseRelayoutRequest({ componentIds: [] })).toThrow('componentIds');
	});
});
