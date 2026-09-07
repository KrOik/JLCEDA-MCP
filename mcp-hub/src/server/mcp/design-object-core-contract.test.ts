import { describe, expect, it } from 'vitest';
import type { DesignObjectRef, EvidenceRef } from '../../../../shared/design-object-core';
import {
	DESIGN_OBJECT_CORE_VERSION,
	MATCH_STATUSES,
	createDesignObjectLookupResponse,
	createMatchResult,
	isEvidenceRef,
} from '../../../../shared/design-object-core';

describe('design object core contract', () => {
	it('represents exact matches without suggestions-as-facts', () => {
		const evidence: EvidenceRef = {
			kind: 'schematic-component',
			sourceTool: 'schematic_locate',
			capturedAt: '2026-05-11T10:00:00.000Z',
			pageUuid: 'page-1',
			primitiveId: 'component-1',
			componentDesignator: 'U1',
			fieldPath: 'matches[0].component.designator',
		};

		const match: DesignObjectRef = {
			id: 'schematic-component:page-1:component-1',
			kind: 'schematic-component',
			label: 'U1',
			confidence: 'exact',
			designator: 'U1',
			primitiveId: 'component-1',
			evidenceRefs: [evidence],
		};

		const result = createMatchResult({
			status: 'exact_match',
			mode: 'exact',
			query: 'U1',
			normalizedQuery: 'u1',
			matches: [match],
			suggestions: [],
			evidenceRefs: [evidence],
			evidenceGaps: [],
		});

		const response = createDesignObjectLookupResponse(result, evidence.capturedAt);

		expect(isEvidenceRef(evidence)).toBe(true);
		expect(MATCH_STATUSES).toContain(response.result.status);
		expect(response.result.exactMatchCount).toBe(1);
		expect(response.result.evidenceSummary).toEqual({
			evidenceCount: 1,
			gapCount: 0,
			hasBlockingGaps: false,
		});
		expect(response.summary).toEqual({
			matchCount: 1,
			suggestionCount: 0,
			evidenceCount: 1,
			gapCount: 0,
		});
	});
});
