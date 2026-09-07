import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { classifyRow, planTypeRows, auditRows, type RowPart } from './type-rows';
import { parseSourceAttributes } from './native-attributes';
const fixture = JSON.parse(readFileSync(new URL('../../../experiments/type-rows/live-fixture.json', import.meta.url), 'utf8'));
const netlist = JSON.parse(fixture.review.netlistText);
const parts: RowPart[] = fixture.parts.map((p: any) => {
	const entry = netlist.components[p.uniqueId];
	const cv = (b: any) => ({ minX: b.minX - p.x, maxX: b.maxX - p.x, minY: p.y - b.maxY, maxY: p.y - b.minY });
	return { id: p.primitiveId, ref: p.designator, row: classifyRow(p.designator, entry.props?.DeviceName), body: cv(p.geometry.body),
		attributes: p.attributes.filter((a: any) => a.box && a.box.maxX > a.box.minX && a.box.maxY > a.box.minY).map((a: any) => ({ id: a.primitiveId, box: cv(a.box) })),
		pins: p.pins.map((pin: any) => ({ number: pin.pinNumber, x: pin.x - p.x, y: p.y - pin.y, angle: pin.rotation, net: entry.pinInfoMap?.[pin.pinNumber]?.net ?? '' })) };
});
describe('type rows with real 15-part/89-pin fixture', () => {
	it('classifies USB U3 as connector and honors explicit override', () => {
		expect(classifyRow('U3', 'Micro USB connector')).toBe('connector');
		expect(classifyRow('U3', 'Micro USB', 'ic')).toBe('ic');
		expect(() => classifyRow('U3', '', 'bad')).toThrow();
	});
	for (const font of [8, 10, 12, 16]) for (const width of [2000, 5000, 10000]) for (const stress of [false, true]) it(`geometry font=${font} width=${width} stress=${stress}`, () => {
		const input = structuredClone(parts);
		if (stress) for (const p of input) for (const pin of p.pins) pin.net = `TEST_${p.ref}_${pin.number}_VERY_LONG_NETWORK_NAME`;
		const plan = planTypeRows(input, { width, height: 10000, font });
		expect(auditRows(plan)).toEqual([]);
		expect(planTypeRows(input, { width, height: 10000, font })).toEqual(plan);
		expect(plan.flatMap(c => c.routes).length).toBe(stress ? 89 : 47);
	});
	it('preserves sparse pin ordering in 100 seeded cases', () => {
		let seed = 9481;
		for (let iteration = 0; iteration < 100; iteration++) {
			const input = structuredClone(parts);
			for (const p of input) for (const pin of p.pins) { seed = (1664525 * seed + 1013904223) >>> 0; pin.net = seed % 3 ? `N_${p.ref}_${pin.number}` : ''; }
			expect(auditRows(planTypeRows(input, { width: 5000, height: 10000 }))).toEqual([]);
		}
	});
	it('paginates without shrinking or overshooting the usable area', () => {
		const plan = planTypeRows(parts);
		expect(new Set(plan.map(c => c.page)).size).toBeGreaterThan(1);
		for (const c of plan) { expect(c.envelope.minX).toBeGreaterThanOrEqual(0); expect(c.envelope.maxX).toBeLessThanOrEqual(1000); expect(c.envelope.maxY).toBeLessThanOrEqual(600); }
		expect(auditRows(plan)).toEqual([]);
	});
	it('rejects oversize and diagonal pins', () => {
		expect(() => planTypeRows([{ ...parts[0], body: { minX: 0, maxX: 50000, minY: 0, maxY: 30 } }])).toThrow('PAGE_TOO_SMALL');
		expect(() => planTypeRows([{ ...parts[0], pins: [{ number: '1', x: 0, y: 0, angle: 45, net: 'N' }] }])).toThrow('UNSUPPORTED_PIN_GEOMETRY');
	});
	it('recovers visible NET IDs from source and rejects a different document', () => {
		const source = '{"type":"DOCHEAD"}||{"uuid":"p"}|\n{"type":"ATTR","id":"a"}||{"key":"NET","parentId":"w","valueVisible":true}|';
		expect(parseSourceAttributes(source, 'p')).toEqual([{ id: 'a', parent: 'w', key: 'NET', visible: true }]);
		expect(() => parseSourceAttributes(source, 'other')).toThrow('DOCUMENT_CHANGED');
	});
});
