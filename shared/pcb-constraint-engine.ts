export const PCB_CONSTRAINT_ENGINE_PLUGIN_ID = 'pcb-constraint-engine';
export const PCB_CONSTRAINT_ENGINE_PLUGIN_VERSION = '0.1.0';

export interface PcbConstraintIncludeOptions {
	ruleConfiguration?: boolean;
	netRules?: boolean;
	netByNetRules?: boolean;
	regionRules?: boolean;
	differentialPairs?: boolean;
	equalLengthNetGroups?: boolean;
	netClasses?: boolean;
	padPairGroups?: boolean;
	vias?: boolean;
	pads?: boolean;
}

export interface PcbConstraintSnapshotRequest {
	nets?: string[];
	viaPrimitiveIds?: string[];
	padPrimitiveIds?: string[];
	include?: PcbConstraintIncludeOptions;
}

export interface PcbConstraintEnginePluginMetadata {
	id: typeof PCB_CONSTRAINT_ENGINE_PLUGIN_ID;
	version: typeof PCB_CONSTRAINT_ENGINE_PLUGIN_VERSION;
	displayName: string;
}

export interface PcbConstraintColor {
	r: number;
	g: number;
	b: number;
	alpha: number;
}

export interface PcbRuleConfigurationSnapshot {
	configurationName: string | null;
	ruleConfiguration: Record<string, unknown> | null;
	netRules: Record<string, unknown>[];
	netByNetRules: Record<string, unknown> | null;
	regionRules: Record<string, unknown>[];
}

export interface PcbDifferentialPairSnapshot {
	name: string;
	positiveNet: string;
	negativeNet: string;
	raw: Record<string, unknown>;
}

export interface PcbEqualLengthNetGroupSnapshot {
	name: string;
	nets: string[];
	color: PcbConstraintColor | null;
	raw: Record<string, unknown>;
}

export interface PcbNetClassSnapshot {
	name: string;
	nets: string[];
	color: PcbConstraintColor | null;
	raw: Record<string, unknown>;
}

export interface PcbPadPairMinWireLengthSnapshot {
	padPair: [string, string];
	minWireLength: number;
}

export interface PcbPadPairGroupSnapshot {
	name: string;
	padPairs: Array<[string, string]>;
	minWireLengths: PcbPadPairMinWireLengthSnapshot[];
	raw: Record<string, unknown>;
}

export interface PcbConstraintViaSnapshot {
	primitiveId: string;
	net: string;
	position: {
		x: number;
		y: number;
	};
	diameter: number;
	holeDiameter: number;
	viaType: string;
	blindViaRuleName: string | null;
	solderMaskExpansion: unknown;
	adjacentPrimitiveIds: string[];
	primitiveLock: boolean;
}

export interface PcbConstraintPadSnapshot {
	primitiveId: string;
	net: string | null;
	layerId: number;
	position: {
		x: number;
		y: number;
	};
	padNumber: string;
	padType: string;
	rotation: number;
	hole: unknown;
	holeOffsetX: number;
	holeOffsetY: number;
	holeRotation: number;
	metallization: boolean;
	padShape: unknown;
	specialPadShape: unknown;
	heatWelding: unknown;
	solderMaskAndPasteMaskExpansion: unknown;
	primitiveLock: boolean;
}

export interface PcbConstraintSnapshotSummary {
	ruleConfigurationLoaded: boolean;
	netRuleCount: number;
	netByNetRuleCount: number;
	regionRuleCount: number;
	differentialPairCount: number;
	equalLengthNetGroupCount: number;
	netClassCount: number;
	padPairGroupCount: number;
	viaCount: number;
	padCount: number;
}

export interface PcbConstraintSnapshotPayload {
	pcbId: string;
	pcbName: string;
	parentProjectUuid: string;
	parentBoardName: string;
	rules: PcbRuleConfigurationSnapshot;
	differentialPairs: PcbDifferentialPairSnapshot[];
	equalLengthNetGroups: PcbEqualLengthNetGroupSnapshot[];
	netClasses: PcbNetClassSnapshot[];
	padPairGroups: PcbPadPairGroupSnapshot[];
	vias: PcbConstraintViaSnapshot[];
	pads: PcbConstraintPadSnapshot[];
	summary: PcbConstraintSnapshotSummary;
}

export interface PcbConstraintSnapshotResponse {
	ok: true;
	plugin: PcbConstraintEnginePluginMetadata;
	generatedAt: string;
	warnings: string[];
	snapshot: PcbConstraintSnapshotPayload;
}
