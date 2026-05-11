export type SchematicLocatorScope = 'current-page' | 'current-schematic' | 'all-schematics';
export type SchematicLocatorMatchStatus = 'exact_match' | 'ambiguous' | 'no_exact_match';
export type SchematicLocatorMatchPolicy = 'exact_then_suggest';

export interface SchematicLocatorRequest {
	query: string;
	scope?: SchematicLocatorScope;
	limit?: number;
}

export interface SchematicLocatorPageContext {
	pageName: string;
	pageUuid: string;
	schematicName: string;
	schematicUuid: string;
	allPageNames: string[];
}

export interface SchematicLocatorPinMatch {
	pinNumber: string;
	pinName: string;
	networkName: string;
	hasNoConnectMark: boolean;
}

export interface SchematicLocatorComponentSource {
	componentInstanceId: string;
	designator: string;
	symbolName: string;
	footprintName: string;
	subPartName: string;
	manufacturer: string;
	manufacturerId: string;
	supplier: string;
	supplierId: string;
	uniqueId: string;
	pageName: string;
	pageUuid: string;
	pageSchematicUuid: string;
	pins: SchematicLocatorPinMatch[];
}

export interface SchematicLocatorNetSource {
	networkName: string;
	connectedPins: string[];
}

export type SchematicLocatorComponentMatch = SchematicLocatorComponentSource;

export interface SchematicLocatorMatch {
	kind: 'component' | 'net';
	score: number;
	matchText: string;
	component?: SchematicLocatorComponentMatch;
	networkName?: string;
	connectedPins?: string[];
}

export interface SchematicLocatorSuggestion extends SchematicLocatorMatch {
	matchReason: 'fuzzy_candidate';
}

export interface SchematicLocatorResponse {
	ok: true;
	query: string;
	normalizedQuery: string;
	scope: SchematicLocatorScope;
	limit: number;
	matchStatus: SchematicLocatorMatchStatus;
	matchPolicy: SchematicLocatorMatchPolicy;
	totalCandidates: number;
	pageContext: SchematicLocatorPageContext;
	matches: SchematicLocatorMatch[];
	suggestions: SchematicLocatorSuggestion[];
	summary: {
		componentCount: number;
		networkCount: number;
		exactMatchCount: number;
		suggestionCount: number;
	};
}

export const SCHEMATIC_LOCATOR_TOOL_NAME = 'schematic_locate';
export const SCHEMATIC_LOCATOR_DEFAULT_SCOPE: SchematicLocatorScope = 'current-schematic';
export const SCHEMATIC_LOCATOR_DEFAULT_LIMIT = 8;
export const SCHEMATIC_LOCATOR_MAX_LIMIT = 12;
