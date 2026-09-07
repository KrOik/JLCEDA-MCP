export const DESIGN_OBJECT_CORE_VERSION = '0.1.0';

export const DESIGN_OBJECT_KINDS = [
	'schematic-component',
	'schematic-pin',
	'schematic-net',
	'pcb-component',
	'pcb-pad',
	'pcb-net',
	'bom-item',
	'rule',
] as const;

export type DesignObjectKind = typeof DESIGN_OBJECT_KINDS[number];

export const EVIDENCE_SOURCE_TOOLS = [
	'schematic_locate',
	'schematic_read',
	'schematic_review',
	'pcb_snapshot',
	'pcb_geometry_analyze',
	'pcb_constraint_snapshot',
	'api_invoke',
	'design_object_lookup',
	'engineering_review',
] as const;

export type EvidenceSourceTool = typeof EVIDENCE_SOURCE_TOOLS[number];

export const EVIDENCE_GAP_REASONS = [
	'not-requested',
	'not-available',
	'not-supported',
	'api-failed',
	'context-missing',
	'unverified-shape',
	'no-exact-match',
	'ambiguous-match',
] as const;

export type EvidenceGapReason = typeof EVIDENCE_GAP_REASONS[number];

export const MATCH_STATUSES = [
	'exact_match',
	'no_exact_match',
	'ambiguous',
	'suggestions_only',
] as const;

export type MatchStatus = typeof MATCH_STATUSES[number];

export const MATCH_MODES = [
	'exact',
	'prefix',
	'fuzzy',
] as const;

export type MatchMode = typeof MATCH_MODES[number];

export const MATCH_CONFIDENCE_LEVELS = [
	'exact',
	'high',
	'medium',
	'low',
] as const;

export type MatchConfidenceLevel = typeof MATCH_CONFIDENCE_LEVELS[number];

export interface EvidenceSummary {
	evidenceCount: number;
	gapCount: number;
	hasBlockingGaps: boolean;
}

export interface EvidenceRef {
	kind: DesignObjectKind;
	sourceTool: EvidenceSourceTool;
	capturedAt: string;
	documentUuid?: string;
	pageUuid?: string;
	boardUuid?: string;
	schematicUuid?: string;
	primitiveId?: string;
	componentDesignator?: string;
	pinNumber?: string;
	padNumber?: string;
	netName?: string;
	ruleName?: string;
	fieldPath?: string;
}

export interface EvidenceGap {
	reason: EvidenceGapReason;
	message: string;
	blocking?: boolean;
	missingKind?: DesignObjectKind;
	sourceTool?: EvidenceSourceTool;
	documentUuid?: string;
	pageUuid?: string;
	netName?: string;
	componentDesignator?: string;
}

export interface DesignObjectRef {
	id: string;
	kind: DesignObjectKind;
	label: string;
	confidence: MatchConfidenceLevel;
	designator?: string;
	netName?: string;
	primitiveId?: string;
	evidenceRefs: EvidenceRef[];
	evidenceGaps?: EvidenceGap[];
}

export interface MatchSuggestion<TMatch extends DesignObjectRef = DesignObjectRef> {
	match: TMatch;
	score: number;
	reason: string;
	confidence: Exclude<MatchConfidenceLevel, 'exact'>;
	evidenceRefs: EvidenceRef[];
}

export interface MatchResult<TMatch extends DesignObjectRef = DesignObjectRef> {
	status: MatchStatus;
	mode: MatchMode;
	query: string;
	normalizedQuery: string;
	exactMatchCount: number;
	matches: TMatch[];
	suggestions: Array<MatchSuggestion<TMatch>>;
	evidenceRefs: EvidenceRef[];
	evidenceGaps: EvidenceGap[];
	evidenceSummary: EvidenceSummary;
}

export interface DesignObjectLookupRequest {
	query: string;
	matchMode?: MatchMode;
	scope?: 'schematic' | 'pcb' | 'both';
	includeBom?: boolean;
}

export interface DesignObjectLookupResponse {
	ok: true;
	coreVersion: typeof DESIGN_OBJECT_CORE_VERSION;
	capturedAt: string;
	result: MatchResult;
	summary: {
		matchCount: number;
		suggestionCount: number;
		evidenceCount: number;
		gapCount: number;
	};
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArrayMember<TValue extends string>(items: readonly TValue[], value: unknown): value is TValue {
	return typeof value === 'string' && items.includes(value as TValue);
}

export function isDesignObjectKind(value: unknown): value is DesignObjectKind {
	return isStringArrayMember(DESIGN_OBJECT_KINDS, value);
}

export function isEvidenceSourceTool(value: unknown): value is EvidenceSourceTool {
	return isStringArrayMember(EVIDENCE_SOURCE_TOOLS, value);
}

export function isEvidenceGapReason(value: unknown): value is EvidenceGapReason {
	return isStringArrayMember(EVIDENCE_GAP_REASONS, value);
}

export function isMatchStatus(value: unknown): value is MatchStatus {
	return isStringArrayMember(MATCH_STATUSES, value);
}

export function isMatchMode(value: unknown): value is MatchMode {
	return isStringArrayMember(MATCH_MODES, value);
}

export function isMatchConfidenceLevel(value: unknown): value is MatchConfidenceLevel {
	return isStringArrayMember(MATCH_CONFIDENCE_LEVELS, value);
}

export function isEvidenceRef(value: unknown): value is EvidenceRef {
	if (!isPlainObjectRecord(value)) {
		return false;
	}
	return isDesignObjectKind(value.kind)
		&& isEvidenceSourceTool(value.sourceTool)
		&& typeof value.capturedAt === 'string'
		&& value.capturedAt.trim().length > 0;
}

export function isEvidenceGap(value: unknown): value is EvidenceGap {
	if (!isPlainObjectRecord(value)) {
		return false;
	}
	return isEvidenceGapReason(value.reason)
		&& typeof value.message === 'string'
		&& value.message.trim().length > 0;
}

export function summarizeEvidence(evidenceRefs: readonly EvidenceRef[], evidenceGaps: readonly EvidenceGap[]): EvidenceSummary {
	return {
		evidenceCount: evidenceRefs.length,
		gapCount: evidenceGaps.length,
		hasBlockingGaps: evidenceGaps.some(gap => gap.blocking === true),
	};
}

export function createMatchResult<TMatch extends DesignObjectRef = DesignObjectRef>(input: {
	status: MatchStatus;
	mode: MatchMode;
	query: string;
	normalizedQuery: string;
	exactMatchCount?: number;
	matches?: TMatch[];
	suggestions?: Array<MatchSuggestion<TMatch>>;
	evidenceRefs?: EvidenceRef[];
	evidenceGaps?: EvidenceGap[];
}): MatchResult<TMatch> {
	const matches = input.matches ?? [];
	const suggestions = input.suggestions ?? [];
	const evidenceRefs = input.evidenceRefs ?? [];
	const evidenceGaps = input.evidenceGaps ?? [];
	return {
		status: input.status,
		mode: input.mode,
		query: input.query,
		normalizedQuery: input.normalizedQuery,
		exactMatchCount: input.exactMatchCount ?? (input.status === 'exact_match' ? matches.length : 0),
		matches,
		suggestions,
		evidenceRefs,
		evidenceGaps,
		evidenceSummary: summarizeEvidence(evidenceRefs, evidenceGaps),
	};
}

export function createDesignObjectLookupResponse(result: MatchResult, capturedAt: string): DesignObjectLookupResponse {
	return {
		ok: true,
		coreVersion: DESIGN_OBJECT_CORE_VERSION,
		capturedAt,
		result,
		summary: {
			matchCount: result.matches.length,
			suggestionCount: result.suggestions.length,
			evidenceCount: result.evidenceSummary.evidenceCount,
			gapCount: result.evidenceSummary.gapCount,
		},
	};
}
