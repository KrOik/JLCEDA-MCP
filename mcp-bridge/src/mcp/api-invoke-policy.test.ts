import { describe, expect, it } from 'vitest';
import { assertApiInvokeAllowed } from './api-invoke-policy';

describe('raw API placement policy', () => {
	it('rejects direct component construction and unsafe wire mutation', () => {
		expect(() => assertApiInvokeAllowed('eda.sch_Document.autoLayout', [{}])).toThrow('PROTECTED_PLACEMENT_API');
		expect(() => assertApiInvokeAllowed('eda.sch_PrimitiveComponent.create', [])).toThrow('PROTECTED_PLACEMENT_API');
		expect(() => assertApiInvokeAllowed('eda.sch_PrimitiveWire.modify', ['wire-1', { line: [0, 0, 10, 0] }])).toThrow('PROTECTED_PLACEMENT_API');
	});

	it('rejects geometry patches but leaves component metadata APIs available', () => {
		expect(() => assertApiInvokeAllowed('eda.sch_PrimitiveComponent.modify', ['part-1', { x: 100 }])).toThrow('PROTECTED_PLACEMENT_API');
		expect(() => assertApiInvokeAllowed('eda.sch_PrimitiveComponent.modify', ['part-1', { designator: 'R1' }])).not.toThrow();
		expect(() => assertApiInvokeAllowed('eda.sch_PrimitiveWire.create', [])).not.toThrow();
	});
});
