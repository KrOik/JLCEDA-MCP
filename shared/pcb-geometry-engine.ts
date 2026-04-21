export const PCB_GEOMETRY_ENGINE_PLUGIN_ID = 'pcb-geometry-engine';
export const PCB_GEOMETRY_ENGINE_PLUGIN_VERSION = '0.1.0';

export const PCB_GEOMETRY_ANALYSIS_MODES = [
	'net_stats',
	'reference_grounding',
	'board_edge_clearance',
	'return_via_clearance',
	'plane_connectivity',
	'loop_area_proxy',
	'spatial_relations',
] as const;

export type PcbGeometryAnalysisMode = typeof PCB_GEOMETRY_ANALYSIS_MODES[number];

export interface PcbSnapshotIncludeOptions {
	lines?: boolean;
	arcs?: boolean;
	vias?: boolean;
	pours?: boolean;
	fills?: boolean;
	regions?: boolean;
	images?: boolean;
	objects?: boolean;
	components?: boolean;
	pads?: boolean;
	boardOutline?: boolean;
	layers?: boolean;
}

export interface PcbSnapshotRequest {
	nets?: string[];
	layerIds?: number[];
	include?: PcbSnapshotIncludeOptions;
}

export interface PcbAnalyzeRequest extends PcbSnapshotRequest {
	tracePrimitiveIds?: string[];
	referenceNetNames?: string[];
	spatialObjectKinds?: PcbSpatialObjectKind[];
	analysisModes?: PcbGeometryAnalysisMode[];
	sampleStep?: number;
	includeSnapshot?: boolean;
}

export interface PcbEnginePluginMetadata {
	id: typeof PCB_GEOMETRY_ENGINE_PLUGIN_ID;
	version: typeof PCB_GEOMETRY_ENGINE_PLUGIN_VERSION;
	displayName: string;
}

export interface PcbLayerSnapshot {
	layerId: number;
	name: string;
	type: string;
	isCopperLayer: boolean;
	isSelectable: boolean;
	orderIndex: number | null;
	status: string | null;
	locked: boolean;
}

export interface PcbPoint {
	x: number;
	y: number;
}

export interface PcbBoundingBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface PcbLineSnapshot {
	primitiveId: string;
	net: string;
	layerId: number;
	start: PcbPoint;
	end: PcbPoint;
	lineWidth: number;
	length: number;
	bbox: PcbBoundingBox;
	primitiveLock: boolean;
}

export interface PcbArcSnapshot {
	primitiveId: string;
	net: string;
	layerId: number;
	start: PcbPoint;
	end: PcbPoint;
	arcAngle: number;
	lineWidth: number;
	length: number;
	bbox: PcbBoundingBox;
	primitiveLock: boolean;
}

export interface PcbViaSnapshot {
	primitiveId: string;
	net: string;
	position: PcbPoint;
	holeDiameter: number;
	diameter: number;
	viaType: string;
	primitiveLock: boolean;
}

export interface PcbPolygonSnapshot {
	source: Array<'L' | 'ARC' | 'CARC' | 'C' | 'R' | 'CIRCLE' | number>;
	bbox: PcbBoundingBox | null;
}

export type PcbSpatialObjectKind = 'pour' | 'fill' | 'region' | 'image' | 'object';

export interface PcbPourFilledRegionSnapshot {
	fillId: string;
	approximateArea: number;
	polygon: PcbPolygonSnapshot;
}

export interface PcbPourSnapshot {
	primitiveId: string;
	net: string;
	layerId: number;
	pourName: string;
	pourPriority: number;
	lineWidth: number;
	preserveSilos: boolean;
	polygon: PcbPolygonSnapshot;
	filledRegions: PcbPourFilledRegionSnapshot[];
	primitiveLock: boolean;
}

export interface PcbFillSnapshot {
	primitiveId: string;
	net: string;
	layerId: number;
	fillMode: string;
	lineWidth: number;
	approximateArea: number;
	polygon: PcbPolygonSnapshot;
	primitiveLock: boolean;
}

export interface PcbRegionSnapshot {
	primitiveId: string;
	layerId: number;
	ruleTypes: string[];
	regionName: string;
	lineWidth: number;
	approximateArea: number;
	polygon: PcbPolygonSnapshot;
	primitiveLock: boolean;
}

export interface PcbImageSnapshot {
	primitiveId: string;
	layerId: number;
	position: PcbPoint;
	width: number;
	height: number;
	rotation: number;
	horizonMirror: boolean;
	polygons: PcbPolygonSnapshot[];
	bbox: PcbBoundingBox | null;
	primitiveLock: boolean;
}

export interface PcbObjectSnapshot {
	primitiveId: string;
	layerId: number | null;
	topLeft: PcbPoint;
	width: number;
	height: number;
	rotation: number;
	mirror: boolean;
	fileName: string;
	bbox: PcbBoundingBox | null;
	primitiveLock: boolean;
}

export interface PcbPadSnapshot {
	primitiveId: string;
	parentComponentPrimitiveId: string;
	net: string;
	layerId: number;
	padNumber: string;
	position: PcbPoint;
	rotation: number;
	hole: unknown;
	padShape: unknown;
	primitiveLock: boolean;
}

export interface PcbComponentSnapshot {
	primitiveId: string;
	layerId: number;
	position: PcbPoint;
	rotation: number;
	designator: string;
	name: string;
	pads: Array<{
		primitiveId: string;
		net: string;
		padNumber: string;
	}>;
	primitiveLock: boolean;
}

export interface PcbBoardOutlineSegmentSnapshot {
	primitiveId: string;
	kind: 'line' | 'arc';
	start: PcbPoint;
	end: PcbPoint;
	arcAngle?: number;
	length: number;
}

export interface PcbSnapshotSummary {
	copperLayerCount: number;
	objectCounts: {
		layers: number;
		lines: number;
		arcs: number;
		vias: number;
		pours: number;
		fills: number;
		regions: number;
		images: number;
		objects: number;
		components: number;
		pads: number;
		boardOutlineSegments: number;
	};
	nets: string[];
}

export interface PcbSnapshotPayload {
	pcbId: string;
	pcbName: string;
	parentProjectUuid: string;
	parentBoardName: string;
	unitSystem: 'editor-coordinate';
	layers: PcbLayerSnapshot[];
	lines: PcbLineSnapshot[];
	arcs: PcbArcSnapshot[];
	vias: PcbViaSnapshot[];
	pours: PcbPourSnapshot[];
	fills: PcbFillSnapshot[];
	regions: PcbRegionSnapshot[];
	images: PcbImageSnapshot[];
	objects: PcbObjectSnapshot[];
	components: PcbComponentSnapshot[];
	pads: PcbPadSnapshot[];
	boardOutlineSegments: PcbBoardOutlineSegmentSnapshot[];
	summary: PcbSnapshotSummary;
}

export interface PcbGeometryRelation {
	relationId: string;
	relationType: string;
	sourceKind: 'trace' | 'via' | 'layer' | 'pour' | 'fill' | 'region' | 'image' | 'object' | 'board' | 'net';
	sourceId: string;
	targetKind: 'trace' | 'via' | 'layer' | 'pour' | 'fill' | 'region' | 'image' | 'object' | 'board' | 'net';
	targetId: string;
	attributes: Record<string, unknown>;
}

export interface PcbGeometryFeature {
	featureId: string;
	featureType: string;
	subjectKind: 'trace' | 'via' | 'net' | 'fill' | 'region' | 'image' | 'object' | 'board';
	subjectId: string;
	values: Record<string, unknown>;
	evidence: Record<string, unknown>;
}

export interface PcbGeometryAnalysisSummary {
	traceCountAnalyzed: number;
	viaCountAnalyzed: number;
	objectCountAnalyzed: number;
	netCountAnalyzed: number;
	relationCount: number;
	featureCount: number;
}

export interface PcbSnapshotResponse {
	ok: true;
	plugin: PcbEnginePluginMetadata;
	generatedAt: string;
	warnings: string[];
	snapshot: PcbSnapshotPayload;
}

export interface PcbAnalyzeResponse {
	ok: true;
	plugin: PcbEnginePluginMetadata;
	generatedAt: string;
	warnings: string[];
	analysisModes: PcbGeometryAnalysisMode[];
	summary: PcbGeometryAnalysisSummary;
	relations: PcbGeometryRelation[];
	features: PcbGeometryFeature[];
	snapshot?: PcbSnapshotPayload;
}
