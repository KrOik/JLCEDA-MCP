import { describe, expect, it } from 'vitest';
import type { DesignObjectRef, EvidenceGap, EvidenceRef, MatchSuggestion } from '../../../shared/design-object-core.ts';
import { EVIDENCE_GAP_REASONS, MATCH_MODES, createMatchResult, isEvidenceGap } from '../../../shared/design-object-core.ts';

describe('design object core contract', () => {
	it('keeps fuzzy suggestions separate from factual matches', () => {
		const suggestionEvidence: EvidenceRef = {
			kind: 'schematic-component',
			sourceTool: 'schematic_locate',
			capturedAt: '2026-05-11T10:00:00.000Z',
			pageUuid: 'page-1',
			primitiveId: 'component-1',
			componentDesignator: 'U1',
		};

		const gap: EvidenceGap = {
			reason: 'no-exact-match',
			message: 'No schematic component exactly matched designator U16.',
			blocking: true,
			missingKind: 'schematic-component',
			componentDesignator: 'U16',
		};

		const suggestionMatch: DesignObjectRef = {
			id: 'schematic-component:page-1:component-1',
			kind: 'schematic-component',
			label: 'U1',
			confidence: 'medium',
			designator: 'U1',
			primitiveId: 'component-1',
			evidenceRefs: [suggestionEvidence],
		};

		const suggestion: MatchSuggestion = {
			match: suggestionMatch,
			score: 65,
			reason: 'Fuzzy designator similarity only; not an exact match.',
			confidence: 'medium',
			evidenceRefs: [suggestionEvidence],
		};

		const result = createMatchResult({
			status: 'no_exact_match',
			mode: 'exact',
			query: 'U16',
			normalizedQuery: 'u16',
			matches: [],
			suggestions: [suggestion],
			evidenceRefs: [],
			evidenceGaps: [gap],
		});

		expect(MATCH_MODES).toContain(result.mode);
		expect(EVIDENCE_GAP_REASONS).toContain(gap.reason);
		expect(isEvidenceGap(gap)).toBe(true);
		expect(result.matches).toHaveLength(0);
		expect(result.exactMatchCount).toBe(0);
		expect(result.evidenceSummary).toEqual({
			evidenceCount: 0,
			gapCount: 1,
			hasBlockingGaps: true,
		});
		expect(result.suggestions[0]?.match.designator).toBe('U1');
	});
});
