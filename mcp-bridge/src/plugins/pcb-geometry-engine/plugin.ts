import type { PcbAnalyzeRequest, PcbAnalyzeResponse, PcbArcSnapshot, PcbBoardOutlineSegmentSnapshot, PcbBoundingBox, PcbComponentSnapshot, PcbEnginePluginMetadata, PcbFillSnapshot, PcbGeometryAnalysisMode, PcbGeometryFeature, PcbGeometryRelation, PcbImageSnapshot, PcbLayerSnapshot, PcbLineSnapshot, PcbObjectSnapshot, PcbPadSnapshot, PcbPoint, PcbPolygonSnapshot, PcbPourFilledRegionSnapshot, PcbPourSnapshot, PcbRegionSnapshot, PcbSnapshotIncludeOptions, PcbSnapshotPayload, PcbSnapshotRequest, PcbSnapshotResponse, PcbSpatialObjectKind, PcbViaSnapshot } from '../../../../shared/pcb-geometry-engine.ts';
import type { BridgePlugin } from '../plugin-contract.ts';
import {
	PCB_GEOMETRY_ANALYSIS_MODES,
	PCB_GEOMETRY_ENGINE_PLUGIN_ID,
	PCB_GEOMETRY_ENGINE_PLUGIN_VERSION,

} from '../../../../shared/pcb-geometry-engine.ts';

import {
	buildSnappedNodeKey,
	createBoundingBox,
	deriveArcGeometry,
	distanceBetweenPoints,
	distancePointToBoardOutline,
	distancePointToSegment,
	distancePolylineToPolygon,
	estimatePolygonArea,
	mergeBoundingBoxes,
	pointInPolygon,
	polygonSourceToPoints,
	polylineIntersectsPolygon,
	rectanglePoints,
	sampleArc,
	sampleLine,
} from './geometry-utils.ts';

const LAYER_TOP = 1;
const LAYER_BOTTOM = 2;
const LAYER_BOARD_OUTLINE = 11;
const LAYER_INNER_1 = 15;

const DEFAULT_REFERENCE_NET_NAMES = ['GND', 'AGND', 'DGND', 'PGND', 'GNDA', 'GNDD', 'GROUND'];
const DEFAULT_SAMPLE_STEP = 8;
const TOPOLOGY_SNAP_TOLERANCE = 1e-3;

interface PcbPrimitiveWithSyncState {
	toSync?: () => unknown;
	getState_PrimitiveId?: () => string;
	getState_PrimitiveLock?: () => boolean;
}

type TraceSnapshot = PcbLineSnapshot | PcbArcSnapshot;

interface ReferenceIslandSnapshot {
	islandId: string;
	layerId: number;
	net: string;
	pourPrimitiveId: string;
	bbox: PcbBoundingBox | null;
	approximateArea: number;
	points: PcbPoint[];
}

interface NetGraphNode {
	key: string;
	point: PcbPoint;
	incidentEdgeIds: string[];
	viaIds: string[];
	padIds: string[];
}

interface NetGraphEdge {
	edgeId: string;
	from: string;
	to: string;
	length: number;
	primitiveId: string;
}

interface SpatialObjectSnapshot {
	objectKind: PcbSpatialObjectKind;
	objectId: string;
	layerId: number | null;
	net: string;
	bbox: PcbBoundingBox | null;
	approximateArea: number;
	polygons: PcbPoint[][];
	attributes: Record<string, unknown>;
}

function toSyncPrimitive<T>(primitive: T): T {
	if (primitive && typeof primitive === 'object' && typeof (primitive as PcbPrimitiveWithSyncState).toSync === 'function') {
		return (primitive as PcbPrimitiveWithSyncState).toSync!() as T;
	}
	return primitive;
}

function getSyncState<T>(obj: unknown, method: string, fallback: T): T {
	try {
		const primitive = toSyncPrimitive(obj as object);
		const fn = (primitive as Record<string, unknown>)?.[method];
		if (typeof fn === 'function') {
			const result = (fn as () => unknown).call(primitive);
			return result == null ? fallback : result as T;
		}
	}
	catch {
		// ignore getter failure and fall back
	}
	return fallback;
}

function asTrimmedStringArray(values: unknown): string[] {
	if (!Array.isArray(values)) {
		return [];
	}
	return values
		.map(item => String(item ?? '').trim())
		.filter(item => item.length > 0);
}

function asIntegerArray(values: unknown): number[] {
	if (!Array.isArray(values)) {
		return [];
	}
	return values
		.filter(item => typeof item === 'number' && Number.isInteger(item))
		.map(item => Number(item));
}

function normalizeIncludeOptions(include: PcbSnapshotIncludeOptions | undefined): Required<PcbSnapshotIncludeOptions> {
	return {
		lines: include?.lines !== false,
		arcs: include?.arcs !== false,
		vias: include?.vias !== false,
		pours: include?.pours !== false,
		fills: include?.fills !== false,
		regions: include?.regions !== false,
		images: include?.images !== false,
		objects: include?.objects !== false,
		components: include?.components !== false,
		pads: include?.pads !== false,
		boardOutline: include?.boardOutline !== false,
		layers: include?.layers !== false,
	};
}

function normalizeSnapshotRequest(payload: unknown): PcbSnapshotRequest {
	const input = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
	return {
		nets: asTrimmedStringArray(input.nets),
		layerIds: asIntegerArray(input.layerIds),
		include: normalizeIncludeOptions((input.include as PcbSnapshotIncludeOptions | undefined)),
	};
}

function isAnalysisMode(value: string): value is PcbGeometryAnalysisMode {
	return (PCB_GEOMETRY_ANALYSIS_MODES as readonly string[]).includes(value);
}

function normalizeAnalyzeRequest(payload: unknown): PcbAnalyzeRequest {
	const input = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
	const analysisModesRaw = asTrimmedStringArray(input.analysisModes);
	const analysisModes = analysisModesRaw.length === 0
		? [...PCB_GEOMETRY_ANALYSIS_MODES]
		: analysisModesRaw.filter(isAnalysisMode);
	if (analysisModes.length === 0) {
		throw new Error(`analysisModes 仅支持: ${PCB_GEOMETRY_ANALYSIS_MODES.join(', ')}。`);
	}

	const sampleStepRaw = input.sampleStep;
	const sampleStep = typeof sampleStepRaw === 'number' && Number.isFinite(sampleStepRaw)
		? Math.min(500, Math.max(1, Math.round(sampleStepRaw)))
		: DEFAULT_SAMPLE_STEP;

	return {
		...normalizeSnapshotRequest(payload),
		tracePrimitiveIds: asTrimmedStringArray(input.tracePrimitiveIds),
		referenceNetNames: asTrimmedStringArray(input.referenceNetNames),
		spatialObjectKinds: asTrimmedStringArray(input.spatialObjectKinds)
			.filter((value): value is PcbSpatialObjectKind => ['pour', 'fill', 'region', 'image', 'object'].includes(value)),
		analysisModes,
		sampleStep,
		includeSnapshot: input.includeSnapshot === true,
	};
}

function toFilterSet(values: string[]): Set<string> {
	return new Set(values.map(item => item.toUpperCase()));
}

function toLayerFilterSet(values: number[]): Set<number> {
	return new Set(values);
}

function matchesNetFilter(net: string | undefined, filters: Set<string>): boolean {
	if (filters.size === 0) {
		return true;
	}
	return filters.has(String(net ?? '').trim().toUpperCase());
}

function matchesLayerFilter(layerId: number, filters: Set<number>): boolean {
	return filters.size === 0 || filters.has(layerId);
}

function buildCopperLayerOrder(copperLayerCount: number): number[] {
	if (copperLayerCount <= 2) {
		return [LAYER_TOP, LAYER_BOTTOM];
	}

	const output = [LAYER_TOP];
	for (let index = 0; index < copperLayerCount - 2; index += 1) {
		output.push(LAYER_INNER_1 + index);
	}
	output.push(LAYER_BOTTOM);
	return output;
}

function buildOrderIndexMap(copperLayerOrder: number[]): Map<number, number> {
	const output = new Map<number, number>();
	copperLayerOrder.forEach((layerId, index) => {
		output.set(layerId, index);
	});
	return output;
}

function buildBoundingBoxFromEndpoints(start: PcbPoint, end: PcbPoint): { minX: number; minY: number; maxX: number; maxY: number } {
	return {
		minX: Math.min(start.x, end.x),
		minY: Math.min(start.y, end.y),
		maxX: Math.max(start.x, end.x),
		maxY: Math.max(start.y, end.y),
	};
}

function uniqueSortedStrings(values: string[]): string[] {
	return Array.from(new Set(values.filter(item => item.length > 0))).sort((a, b) => a.localeCompare(b));
}

function uniqueSortedNumbers(values: number[]): number[] {
	return Array.from(new Set(values)).sort((a, b) => a - b);
}

function createPointBoundingBox(point: PcbPoint): PcbBoundingBox {
	return {
		minX: point.x,
		minY: point.y,
		maxX: point.x,
		maxY: point.y,
	};
}

function createPolygonSnapshot(source: PcbPourSnapshot['polygon']['source'], step = DEFAULT_SAMPLE_STEP): {
	polygon: PcbPourSnapshot['polygon'];
	points: PcbPoint[];
	approximateArea: number;
} {
	const points = polygonSourceToPoints(source, step);
	return {
		polygon: {
			source,
			bbox: createBoundingBox(points),
		},
		points,
		approximateArea: estimatePolygonArea(points),
	};
}

function normalizePolygonSource(rawPolygon: unknown): PcbPourSnapshot['polygon']['source'] {
	const sourceObject = rawPolygon as { getSource?: () => PcbPourSnapshot['polygon']['source'] };
	return typeof sourceObject?.getSource === 'function' ? sourceObject.getSource() : [];
}

function normalizePolygonSources(rawPolygon: unknown): PcbPolygonSnapshot['source'][] {
	if (Array.isArray(rawPolygon) && rawPolygon.length > 0 && Array.isArray(rawPolygon[0])) {
		return rawPolygon as PcbPolygonSnapshot['source'][];
	}
	if (Array.isArray(rawPolygon)) {
		return [rawPolygon as PcbPolygonSnapshot['source']];
	}
	return [];
}

function createRectanglePolygonSnapshot(topLeft: PcbPoint, width: number, height: number, rotation: number): {
	polygon: PcbPolygonSnapshot;
	points: PcbPoint[];
	approximateArea: number;
} {
	const points = rectanglePoints(topLeft.x, topLeft.y, width, height, rotation);
	return {
		polygon: {
			source: ['R', topLeft.x, topLeft.y, width, height, rotation, 0],
			bbox: createBoundingBox(points),
		},
		points,
		approximateArea: estimatePolygonArea(points),
	};
}

function normalizeSpatialObjectKinds(kinds: PcbSpatialObjectKind[] | undefined): Set<PcbSpatialObjectKind> {
	return new Set((kinds?.length ? kinds : ['pour', 'fill', 'region', 'image', 'object']));
}

function compressNullableSequence(values: Array<string | null>): Array<string | null> {
	const output: Array<string | null> = [];
	for (const value of values) {
		if (output.length === 0 || output[output.length - 1] !== value) {
			output.push(value);
		}
	}
	return output;
}

function countSequenceTransitions(values: Array<string | null>): number {
	let count = 0;
	for (let index = 1; index < values.length; index += 1) {
		if (values[index] !== values[index - 1]) {
			count += 1;
		}
	}
	return count;
}

function buildUnsupportedSampleSegments(samples: PcbPoint[], sampledIslandIds: Array<string | null>): Array<Record<string, unknown>> {
	const output: Array<Record<string, unknown>> = [];
	let segmentStartIndex: number | null = null;

	for (let index = 0; index < sampledIslandIds.length; index += 1) {
		if (sampledIslandIds[index] == null && segmentStartIndex == null) {
			segmentStartIndex = index;
		}

		const reachedSupportedSample = sampledIslandIds[index] != null;
		const reachedSequenceEnd = index === sampledIslandIds.length - 1;
		if (segmentStartIndex == null || (!reachedSupportedSample && !reachedSequenceEnd)) {
			continue;
		}

		const segmentEndIndex = reachedSupportedSample ? index - 1 : index;
		if (segmentEndIndex >= segmentStartIndex) {
			const startPoint = samples[segmentStartIndex];
			const endPoint = samples[segmentEndIndex];
			output.push({
				startSampleIndex: segmentStartIndex,
				endSampleIndex: segmentEndIndex,
				startPoint,
				endPoint,
				lengthEstimate: startPoint && endPoint ? distanceBetweenPoints(startPoint, endPoint) : 0,
			});
		}
		segmentStartIndex = null;
	}

	return output;
}

function pointKey(point: PcbPoint): string {
	return buildSnappedNodeKey(point.x, point.y, TOPOLOGY_SNAP_TOLERANCE);
}

function ensureGraphNode(nodes: Map<string, NetGraphNode>, point: PcbPoint): NetGraphNode {
	const key = pointKey(point);
	const existing = nodes.get(key);
	if (existing) {
		return existing;
	}

	const created: NetGraphNode = {
		key,
		point,
		incidentEdgeIds: [],
		viaIds: [],
		padIds: [],
	};
	nodes.set(key, created);
	return created;
}

function pointsEqual(a: PcbPoint, b: PcbPoint, tolerance = TOPOLOGY_SNAP_TOLERANCE): boolean {
	return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function pointDistanceToTrace(trace: TraceSnapshot, point: PcbPoint, sampleStep = DEFAULT_SAMPLE_STEP): number {
	if (!('arcAngle' in trace)) {
		return distancePointToSegment(point, trace.start, trace.end);
	}

	const samples = traceToPoints(trace, sampleStep);
	let best = Number.POSITIVE_INFINITY;
	for (let index = 0; index + 1 < samples.length; index += 1) {
		best = Math.min(best, distancePointToSegment(point, samples[index], samples[index + 1]));
	}
	return best;
}

function sortPointsAlongTrace(trace: TraceSnapshot, points: PcbPoint[], sampleStep = DEFAULT_SAMPLE_STEP): PcbPoint[] {
	if (!('arcAngle' in trace)) {
		const totalDx = trace.end.x - trace.start.x;
		const totalDy = trace.end.y - trace.start.y;
		const total = Math.abs(totalDx) >= Math.abs(totalDy) ? totalDx : totalDy;
		return [...points].sort((a, b) => {
			const ratioA = Math.abs(total) <= 1e-6 ? 0 : ((Math.abs(totalDx) >= Math.abs(totalDy) ? a.x - trace.start.x : a.y - trace.start.y) / total);
			const ratioB = Math.abs(total) <= 1e-6 ? 0 : ((Math.abs(totalDx) >= Math.abs(totalDy) ? b.x - trace.start.x : b.y - trace.start.y) / total);
			return ratioA - ratioB;
		});
	}

	const samples = traceToPoints(trace, sampleStep);
	const cumulative: number[] = [0];
	for (let index = 0; index + 1 < samples.length; index += 1) {
		cumulative.push(cumulative[index] + distanceBetweenPoints(samples[index], samples[index + 1]));
	}

	function distanceAlongTrace(point: PcbPoint): number {
		let bestIndex = 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let index = 0; index < samples.length; index += 1) {
			const distance = distanceBetweenPoints(point, samples[index]);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = index;
			}
		}
		return cumulative[bestIndex] ?? 0;
	}

	return [...points].sort((a, b) => distanceAlongTrace(a) - distanceAlongTrace(b));
}

function uniquePoints(points: PcbPoint[], tolerance = 1e-3): PcbPoint[] {
	const output: PcbPoint[] = [];
	for (const point of points) {
		if (!output.some(existing => pointsEqual(existing, point, tolerance))) {
			output.push(point);
		}
	}
	return output;
}

function buildNetGraph(traces: TraceSnapshot[], vias: PcbViaSnapshot[], pads: PcbPadSnapshot[]): {
	nodes: Map<string, NetGraphNode>;
	edges: Map<string, NetGraphEdge>;
} {
	const nodes = new Map<string, NetGraphNode>();
	const edges = new Map<string, NetGraphEdge>();

	const anchorPoints = uniquePoints([
		...traces.flatMap(trace => [trace.start, trace.end]),
		...vias.map(via => via.position),
		...pads.map(pad => pad.position),
	]);

	for (const trace of traces) {
		const onTracePoints = sortPointsAlongTrace(
			trace,
			uniquePoints(anchorPoints.filter(point => pointDistanceToTrace(trace, point) <= TOPOLOGY_SNAP_TOLERANCE)),
		);
		for (let index = 0; index + 1 < onTracePoints.length; index += 1) {
			const segmentStart = onTracePoints[index];
			const segmentEnd = onTracePoints[index + 1];
			if (pointsEqual(segmentStart, segmentEnd)) {
				continue;
			}

			const startNode = ensureGraphNode(nodes, segmentStart);
			const endNode = ensureGraphNode(nodes, segmentEnd);
			const edgeId = `edge:${trace.primitiveId}:${index}`;
			edges.set(edgeId, {
				edgeId,
				from: startNode.key,
				to: endNode.key,
				length: distanceBetweenPoints(segmentStart, segmentEnd),
				primitiveId: trace.primitiveId,
			});
			startNode.incidentEdgeIds.push(edgeId);
			endNode.incidentEdgeIds.push(edgeId);
		}
	}

	for (const via of vias) {
		ensureGraphNode(nodes, via.position).viaIds.push(via.primitiveId);
	}

	for (const pad of pads) {
		ensureGraphNode(nodes, pad.position).padIds.push(pad.primitiveId);
	}

	return { nodes, edges };
}

function countConnectedComponents(graph: { nodes: Map<string, NetGraphNode>; edges: Map<string, NetGraphEdge> }): number {
	const visited = new Set<string>();
	let count = 0;

	for (const node of graph.nodes.values()) {
		if (visited.has(node.key) || node.incidentEdgeIds.length === 0) {
			continue;
		}

		count += 1;
		const stack = [node.key];
		visited.add(node.key);
		while (stack.length > 0) {
			const currentKey = stack.pop()!;
			const current = graph.nodes.get(currentKey);
			if (!current) {
				continue;
			}

			for (const edgeId of current.incidentEdgeIds) {
				const edge = graph.edges.get(edgeId);
				if (!edge) {
					continue;
				}
				const nextKey = edge.from === currentKey ? edge.to : edge.from;
				if (!visited.has(nextKey)) {
					visited.add(nextKey);
					stack.push(nextKey);
				}
			}
		}
	}

	return count;
}

function computeShortestPathTree(
	startKey: string,
	graph: { nodes: Map<string, NetGraphNode>; edges: Map<string, NetGraphEdge> },
): { distances: Map<string, number>; previous: Map<string, string | null> } {
	const distances = new Map<string, number>();
	const previous = new Map<string, string | null>();
	const pending = new Set<string>();
	for (const key of graph.nodes.keys()) {
		distances.set(key, Number.POSITIVE_INFINITY);
		previous.set(key, null);
		pending.add(key);
	}
	distances.set(startKey, 0);

	while (pending.size > 0) {
		let currentKey: string | undefined;
		let currentDistance = Number.POSITIVE_INFINITY;
		for (const key of pending) {
			const candidate = distances.get(key) ?? Number.POSITIVE_INFINITY;
			if (candidate < currentDistance) {
				currentDistance = candidate;
				currentKey = key;
			}
		}

		if (currentKey == null || !Number.isFinite(currentDistance)) {
			break;
		}
		pending.delete(currentKey);

		const current = graph.nodes.get(currentKey);
		if (!current) {
			continue;
		}
		for (const edgeId of current.incidentEdgeIds) {
			const edge = graph.edges.get(edgeId);
			if (!edge) {
				continue;
			}
			const nextKey = edge.from === currentKey ? edge.to : edge.from;
			if (!pending.has(nextKey)) {
				continue;
			}
			const nextDistance = currentDistance + edge.length;
			if (nextDistance < (distances.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
				distances.set(nextKey, nextDistance);
				previous.set(nextKey, currentKey);
			}
		}
	}

	return { distances, previous };
}

function reconstructNodePath(endKey: string, previous: Map<string, string | null>): string[] {
	const path: string[] = [];
	let current: string | null | undefined = endKey;
	while (current != null) {
		path.push(current);
		current = previous.get(current);
	}
	return path.reverse();
}

function getMainPathNodeKeys(graph: { nodes: Map<string, NetGraphNode>; edges: Map<string, NetGraphEdge> }): string[] {
	const candidateKeys = Array.from(graph.nodes.values())
		.filter(node => node.incidentEdgeIds.length > 0 && node.incidentEdgeIds.length <= 1)
		.map(node => node.key);
	const keys = candidateKeys.length >= 2
		? candidateKeys
		: Array.from(graph.nodes.values()).filter(node => node.incidentEdgeIds.length > 0).map(node => node.key);

	let bestDistance = 0;
	let bestPath: string[] = [];
	for (let index = 0; index < keys.length; index += 1) {
		const tree = computeShortestPathTree(keys[index], graph);
		for (let inner = index + 1; inner < keys.length; inner += 1) {
			const distance = tree.distances.get(keys[inner]) ?? 0;
			if (distance > bestDistance) {
				bestDistance = distance;
				bestPath = reconstructNodePath(keys[inner], tree.previous);
			}
		}
	}
	return bestPath;
}

function estimateMainPathLength(graph: { nodes: Map<string, NetGraphNode>; edges: Map<string, NetGraphEdge> }): number {
	const mainPath = getMainPathNodeKeys(graph);
	if (mainPath.length < 2) {
		return 0;
	}

	let total = 0;
	for (let index = 0; index + 1 < mainPath.length; index += 1) {
		const current = graph.nodes.get(mainPath[index]);
		const next = graph.nodes.get(mainPath[index + 1]);
		if (!current || !next) {
			continue;
		}
		total += distanceBetweenPoints(current.point, next.point);
	}
	return total;
}

function estimateLoopAreaProxy(graph: { nodes: Map<string, NetGraphNode>; edges: Map<string, NetGraphEdge> }): {
	mainPathNodeKeys: string[];
	projectedLoopAreaProxy: number;
} {
	const mainPathNodeKeys = getMainPathNodeKeys(graph);
	if (mainPathNodeKeys.length < 2) {
		return {
			mainPathNodeKeys,
			projectedLoopAreaProxy: 0,
		};
	}

	const startPoint = graph.nodes.get(mainPathNodeKeys[0])?.point;
	const endPoint = graph.nodes.get(mainPathNodeKeys[mainPathNodeKeys.length - 1])?.point;
	if (!startPoint || !endPoint) {
		return {
			mainPathNodeKeys,
			projectedLoopAreaProxy: 0,
		};
	}

	let projectedLoopAreaProxy = 0;
	for (let index = 0; index + 1 < mainPathNodeKeys.length; index += 1) {
		const start = graph.nodes.get(mainPathNodeKeys[index])?.point;
		const end = graph.nodes.get(mainPathNodeKeys[index + 1])?.point;
		if (!start || !end) {
			continue;
		}
		const mid = {
			x: (start.x + end.x) / 2,
			y: (start.y + end.y) / 2,
		};
		projectedLoopAreaProxy += distanceBetweenPoints(start, end) * distancePointToSegment(mid, startPoint, endPoint);
	}

	return {
		mainPathNodeKeys,
		projectedLoopAreaProxy,
	};
}

function estimateStubStats(graph: { nodes: Map<string, NetGraphNode>; edges: Map<string, NetGraphEdge> }): {
	stubCount: number;
	stubLengthEstimate: number;
} {
	let stubCount = 0;
	let stubLengthEstimate = 0;
	const visitedEdgeIds = new Set<string>();
	const leafNodes = Array.from(graph.nodes.values())
		.filter(node => node.incidentEdgeIds.length === 1 && node.padIds.length === 0 && node.viaIds.length === 0);

	for (const leaf of leafNodes) {
		let current = leaf;
		let previousEdgeId: string | null = null;
		let accumulatedLength = 0;

		while (true) {
			const nextEdgeIds = current.incidentEdgeIds.filter(edgeId => edgeId !== previousEdgeId);
			if (nextEdgeIds.length !== 1) {
				break;
			}

			const edge = graph.edges.get(nextEdgeIds[0]);
			if (!edge || visitedEdgeIds.has(edge.edgeId)) {
				break;
			}
			visitedEdgeIds.add(edge.edgeId);
			accumulatedLength += edge.length;

			const nextKey = edge.from === current.key ? edge.to : edge.from;
			const nextNode = graph.nodes.get(nextKey);
			if (!nextNode) {
				break;
			}

			if (nextNode.incidentEdgeIds.length !== 2 || nextNode.padIds.length > 0 || nextNode.viaIds.length > 0) {
				break;
			}

			current = nextNode;
			previousEdgeId = edge.edgeId;
		}

		if (accumulatedLength > 0) {
			stubCount += 1;
			stubLengthEstimate += accumulatedLength;
		}
	}

	return { stubCount, stubLengthEstimate };
}

function buildPadEndpoints(pads: PcbPadSnapshot[], componentMap: Map<string, PcbComponentSnapshot>): Array<Record<string, unknown>> {
	return pads
		.map((pad) => {
			const component = componentMap.get(pad.parentComponentPrimitiveId);
			return {
				padPrimitiveId: pad.primitiveId,
				parentComponentPrimitiveId: pad.parentComponentPrimitiveId,
				componentDesignator: component?.designator ?? '',
				padNumber: pad.padNumber,
			};
		})
		.sort((a, b) => String(a.componentDesignator).localeCompare(String(b.componentDesignator))
			|| String(a.padNumber).localeCompare(String(b.padNumber)));
}

function traceToPoints(trace: TraceSnapshot, sampleStep: number): PcbPoint[] {
	return 'arcAngle' in trace
		? sampleArc(trace.start, trace.end, trace.arcAngle, sampleStep)
		: sampleLine(trace.start, trace.end, sampleStep);
}

function buildSpatialObjects(
	snapshot: Pick<PcbSnapshotPayload, 'pours' | 'fills' | 'regions' | 'images' | 'objects'>,
	objectKinds: Set<PcbSpatialObjectKind>,
): SpatialObjectSnapshot[] {
	const output: SpatialObjectSnapshot[] = [];

	if (objectKinds.has('pour')) {
		for (const pour of snapshot.pours) {
			const sourceRegions = pour.filledRegions.length > 0
				? pour.filledRegions.map(region => ({
						bbox: region.polygon.bbox,
						approximateArea: region.approximateArea,
						points: polygonSourceToPoints(region.polygon.source),
					}))
				: [{
						bbox: pour.polygon.bbox,
						approximateArea: estimatePolygonArea(polygonSourceToPoints(pour.polygon.source)),
						points: polygonSourceToPoints(pour.polygon.source),
					}];
			output.push({
				objectKind: 'pour',
				objectId: pour.primitiveId,
				layerId: pour.layerId,
				net: pour.net,
				bbox: mergeBoundingBoxes(sourceRegions.map(region => region.bbox)),
				approximateArea: sourceRegions.reduce((sum, region) => sum + region.approximateArea, 0),
				polygons: sourceRegions.map(region => region.points).filter(points => points.length >= 3),
				attributes: {
					pourName: pour.pourName,
					preserveSilos: pour.preserveSilos,
				},
			});
		}
	}

	if (objectKinds.has('fill')) {
		for (const fill of snapshot.fills) {
			output.push({
				objectKind: 'fill',
				objectId: fill.primitiveId,
				layerId: fill.layerId,
				net: fill.net,
				bbox: fill.polygon.bbox,
				approximateArea: fill.approximateArea,
				polygons: [polygonSourceToPoints(fill.polygon.source)].filter(points => points.length >= 3),
				attributes: {
					fillMode: fill.fillMode,
				},
			});
		}
	}

	if (objectKinds.has('region')) {
		for (const region of snapshot.regions) {
			output.push({
				objectKind: 'region',
				objectId: region.primitiveId,
				layerId: region.layerId,
				net: '',
				bbox: region.polygon.bbox,
				approximateArea: region.approximateArea,
				polygons: [polygonSourceToPoints(region.polygon.source)].filter(points => points.length >= 3),
				attributes: {
					ruleTypes: region.ruleTypes,
					regionName: region.regionName,
				},
			});
		}
	}

	if (objectKinds.has('image')) {
		for (const image of snapshot.images) {
			output.push({
				objectKind: 'image',
				objectId: image.primitiveId,
				layerId: image.layerId,
				net: '',
				bbox: image.bbox,
				approximateArea: image.polygons.reduce((sum, polygon) => sum + estimatePolygonArea(polygonSourceToPoints(polygon.source)), 0),
				polygons: image.polygons.map(polygon => polygonSourceToPoints(polygon.source)).filter(points => points.length >= 3),
				attributes: {
					width: image.width,
					height: image.height,
				},
			});
		}
	}

	if (objectKinds.has('object')) {
		for (const object of snapshot.objects) {
			const points = rectanglePoints(object.topLeft.x, object.topLeft.y, object.width, object.height, object.rotation);
			output.push({
				objectKind: 'object',
				objectId: object.primitiveId,
				layerId: object.layerId,
				net: '',
				bbox: object.bbox,
				approximateArea: estimatePolygonArea(points),
				polygons: [points],
				attributes: {
					fileName: object.fileName,
				},
			});
		}
	}

	return output;
}

async function readLayerSnapshot(copperOrderIndexMap: Map<number, number>): Promise<PcbLayerSnapshot[]> {
	const layerItems = await eda.pcb_Layer.getAllLayers();
	return (Array.isArray(layerItems) ? layerItems : []).map((item) => {
		const layerId = Number((item as { id: number }).id);
		const type = String((item as { type?: string }).type ?? '');
		return {
			layerId,
			name: String((item as { name?: string }).name ?? ''),
			type,
			isCopperLayer: copperOrderIndexMap.has(layerId),
			isSelectable: layerId !== LAYER_BOARD_OUTLINE,
			orderIndex: copperOrderIndexMap.get(layerId) ?? null,
			status: String((item as { layerStatus?: unknown }).layerStatus ?? ''),
			locked: Boolean((item as { locked?: boolean }).locked),
		};
	});
}

async function readLineSnapshots(netFilters: Set<string>, layerFilters: Set<number>): Promise<PcbLineSnapshot[]> {
	const rawLines = await eda.pcb_PrimitiveLine.getAll();
	const output: PcbLineSnapshot[] = [];
	for (const rawLine of Array.isArray(rawLines) ? rawLines : []) {
		const primitiveId = getSyncState<string>(rawLine, 'getState_PrimitiveId', '');
		const net = getSyncState<string>(rawLine, 'getState_Net', '');
		const layerId = Number(getSyncState<number>(rawLine, 'getState_Layer', 0));
		if (!matchesNetFilter(net, netFilters) || !matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const start = {
			x: Number(getSyncState<number>(rawLine, 'getState_StartX', 0)),
			y: Number(getSyncState<number>(rawLine, 'getState_StartY', 0)),
		};
		const end = {
			x: Number(getSyncState<number>(rawLine, 'getState_EndX', 0)),
			y: Number(getSyncState<number>(rawLine, 'getState_EndY', 0)),
		};

		output.push({
			primitiveId,
			net,
			layerId,
			start,
			end,
			lineWidth: Number(getSyncState<number>(rawLine, 'getState_LineWidth', 0)),
			length: distanceBetweenPoints(start, end),
			bbox: buildBoundingBoxFromEndpoints(start, end),
			primitiveLock: Boolean(getSyncState<boolean>(rawLine, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readArcSnapshots(netFilters: Set<string>, layerFilters: Set<number>): Promise<PcbArcSnapshot[]> {
	const rawArcs = await eda.pcb_PrimitiveArc.getAll();
	const output: PcbArcSnapshot[] = [];
	for (const rawArc of Array.isArray(rawArcs) ? rawArcs : []) {
		const primitiveId = getSyncState<string>(rawArc, 'getState_PrimitiveId', '');
		const net = getSyncState<string>(rawArc, 'getState_Net', '');
		const layerId = Number(getSyncState<number>(rawArc, 'getState_Layer', 0));
		if (!matchesNetFilter(net, netFilters) || !matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const start = {
			x: Number(getSyncState<number>(rawArc, 'getState_StartX', 0)),
			y: Number(getSyncState<number>(rawArc, 'getState_StartY', 0)),
		};
		const end = {
			x: Number(getSyncState<number>(rawArc, 'getState_EndX', 0)),
			y: Number(getSyncState<number>(rawArc, 'getState_EndY', 0)),
		};
		const arcAngle = Number(getSyncState<number>(rawArc, 'getState_ArcAngle', 0));
		const geometry = deriveArcGeometry(start, end, arcAngle);
		const sampled = sampleArc(start, end, arcAngle, DEFAULT_SAMPLE_STEP);
		output.push({
			primitiveId,
			net,
			layerId,
			start,
			end,
			arcAngle,
			lineWidth: Number(getSyncState<number>(rawArc, 'getState_LineWidth', 0)),
			length: geometry?.length ?? distanceBetweenPoints(start, end),
			bbox: createBoundingBox(sampled) ?? buildBoundingBoxFromEndpoints(start, end),
			primitiveLock: Boolean(getSyncState<boolean>(rawArc, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readViaSnapshots(netFilters: Set<string>): Promise<PcbViaSnapshot[]> {
	const rawVias = await eda.pcb_PrimitiveVia.getAll();
	const output: PcbViaSnapshot[] = [];
	for (const rawVia of Array.isArray(rawVias) ? rawVias : []) {
		const net = getSyncState<string>(rawVia, 'getState_Net', '');
		if (!matchesNetFilter(net, netFilters)) {
			continue;
		}

		output.push({
			primitiveId: getSyncState<string>(rawVia, 'getState_PrimitiveId', ''),
			net,
			position: {
				x: Number(getSyncState<number>(rawVia, 'getState_X', 0)),
				y: Number(getSyncState<number>(rawVia, 'getState_Y', 0)),
			},
			holeDiameter: Number(getSyncState<number>(rawVia, 'getState_HoleDiameter', 0)),
			diameter: Number(getSyncState<number>(rawVia, 'getState_Diameter', 0)),
			viaType: String(getSyncState<string>(rawVia, 'getState_ViaType', '')),
			primitiveLock: Boolean(getSyncState<boolean>(rawVia, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

function readPolygonSnapshot(rawPolygon: unknown): PcbPourSnapshot['polygon'] {
	return createPolygonSnapshot(normalizePolygonSource(rawPolygon)).polygon;
}

async function readPourFilledRegions(rawPour: unknown): Promise<PcbPourFilledRegionSnapshot[]> {
	const primitive = toSyncPrimitive(rawPour as object) as Record<string, unknown>;
	const getCopperRegion = primitive?.getCopperRegion;
	if (typeof getCopperRegion !== 'function') {
		return [];
	}

	const copperRegion = await (getCopperRegion as () => Promise<unknown>).call(primitive);
	const fills = getSyncState<Array<Record<string, unknown>>>(copperRegion, 'getState_PourFills', []);
	return fills.map((fill, index) => {
		const source = normalizePolygonSource(fill.path);
		const geometry = createPolygonSnapshot(source);
		return {
			fillId: String(fill.id ?? `fill-${index}`),
			approximateArea: geometry.approximateArea,
			polygon: geometry.polygon,
		};
	});
}

async function readPourSnapshots(netFilters: Set<string>, layerFilters: Set<number>): Promise<PcbPourSnapshot[]> {
	const rawPours = await eda.pcb_PrimitivePour.getAll();
	const output: PcbPourSnapshot[] = [];
	for (const rawPour of Array.isArray(rawPours) ? rawPours : []) {
		const net = getSyncState<string>(rawPour, 'getState_Net', '');
		const layerId = Number(getSyncState<number>(rawPour, 'getState_Layer', 0));
		if (!matchesNetFilter(net, netFilters) || !matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const filledRegions = await readPourFilledRegions(rawPour);

		output.push({
			primitiveId: getSyncState<string>(rawPour, 'getState_PrimitiveId', ''),
			net,
			layerId,
			pourName: getSyncState<string>(rawPour, 'getState_PourName', ''),
			pourPriority: Number(getSyncState<number>(rawPour, 'getState_PourPriority', 0)),
			lineWidth: Number(getSyncState<number>(rawPour, 'getState_LineWidth', 0)),
			preserveSilos: Boolean(getSyncState<boolean>(rawPour, 'getState_PreserveSilos', false)),
			polygon: readPolygonSnapshot(getSyncState<unknown>(rawPour, 'getState_ComplexPolygon', undefined)),
			filledRegions,
			primitiveLock: Boolean(getSyncState<boolean>(rawPour, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readFillSnapshots(netFilters: Set<string>, layerFilters: Set<number>): Promise<PcbFillSnapshot[]> {
	const rawFills = await eda.pcb_PrimitiveFill.getAll();
	const output: PcbFillSnapshot[] = [];
	for (const rawFill of Array.isArray(rawFills) ? rawFills : []) {
		const layerId = Number(getSyncState<number>(rawFill, 'getState_Layer', 0));
		const net = getSyncState<string | undefined>(rawFill, 'getState_Net', '') ?? '';
		if (!matchesLayerFilter(layerId, layerFilters) || !matchesNetFilter(net, netFilters)) {
			continue;
		}

		const geometry = createPolygonSnapshot(normalizePolygonSource(getSyncState<unknown>(rawFill, 'getState_ComplexPolygon', undefined)));
		output.push({
			primitiveId: getSyncState<string>(rawFill, 'getState_PrimitiveId', ''),
			net,
			layerId,
			fillMode: String(getSyncState<string>(rawFill, 'getState_FillMode', '')),
			lineWidth: Number(getSyncState<number>(rawFill, 'getState_LineWidth', 0)),
			approximateArea: geometry.approximateArea,
			polygon: geometry.polygon,
			primitiveLock: Boolean(getSyncState<boolean>(rawFill, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readRegionSnapshots(layerFilters: Set<number>): Promise<PcbRegionSnapshot[]> {
	const rawRegions = await eda.pcb_PrimitiveRegion.getAll();
	const output: PcbRegionSnapshot[] = [];
	for (const rawRegion of Array.isArray(rawRegions) ? rawRegions : []) {
		const layerId = Number(getSyncState<number>(rawRegion, 'getState_Layer', 0));
		if (!matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const geometry = createPolygonSnapshot(normalizePolygonSource(getSyncState<unknown>(rawRegion, 'getState_ComplexPolygon', undefined)));
		output.push({
			primitiveId: getSyncState<string>(rawRegion, 'getState_PrimitiveId', ''),
			layerId,
			ruleTypes: asTrimmedStringArray(getSyncState<unknown[]>(rawRegion, 'getState_RuleType', [])),
			regionName: String(getSyncState<string | undefined>(rawRegion, 'getState_RegionName', '') ?? ''),
			lineWidth: Number(getSyncState<number>(rawRegion, 'getState_LineWidth', 0)),
			approximateArea: geometry.approximateArea,
			polygon: geometry.polygon,
			primitiveLock: Boolean(getSyncState<boolean>(rawRegion, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readImageSnapshots(layerFilters: Set<number>): Promise<PcbImageSnapshot[]> {
	const rawImages = await eda.pcb_PrimitiveImage.getAll();
	const output: PcbImageSnapshot[] = [];
	for (const rawImage of Array.isArray(rawImages) ? rawImages : []) {
		const layerId = Number(getSyncState<number>(rawImage, 'getState_Layer', 0));
		if (!matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const polygonSources = normalizePolygonSources(getSyncState<unknown>(rawImage, 'getState_ComplexPolygon', []));
		const polygons = polygonSources.map(source => createPolygonSnapshot(source));
		output.push({
			primitiveId: getSyncState<string>(rawImage, 'getState_PrimitiveId', ''),
			layerId,
			position: {
				x: Number(getSyncState<number>(rawImage, 'getState_X', 0)),
				y: Number(getSyncState<number>(rawImage, 'getState_Y', 0)),
			},
			width: Number(getSyncState<number>(rawImage, 'getState_Width', 0)),
			height: Number(getSyncState<number>(rawImage, 'getState_Height', 0)),
			rotation: Number(getSyncState<number>(rawImage, 'getState_Rotation', 0)),
			horizonMirror: Boolean(getSyncState<boolean>(rawImage, 'getState_HorizonMirror', false)),
			polygons: polygons.map(item => item.polygon),
			bbox: mergeBoundingBoxes(polygons.map(item => item.polygon.bbox)),
			primitiveLock: Boolean(getSyncState<boolean>(rawImage, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readObjectSnapshots(layerFilters: Set<number>): Promise<PcbObjectSnapshot[]> {
	const rawObjects = await eda.pcb_PrimitiveObject.getAll();
	const output: PcbObjectSnapshot[] = [];
	for (const rawObject of Array.isArray(rawObjects) ? rawObjects : []) {
		const layerIdRaw = getSyncState<number | undefined>(rawObject, 'getState_Layer', undefined);
		const layerId = typeof layerIdRaw === 'number' && Number.isFinite(layerIdRaw) ? Number(layerIdRaw) : null;
		if (layerId != null && !matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const topLeft = {
			x: Number(getSyncState<number | undefined>(rawObject, 'getState_TopLeftX', 0) ?? 0),
			y: Number(getSyncState<number | undefined>(rawObject, 'getState_TopLeftY', 0) ?? 0),
		};
		const width = Number(getSyncState<number>(rawObject, 'getState_Width', 0));
		const height = Number(getSyncState<number>(rawObject, 'getState_Height', 0));
		const rotation = Number(getSyncState<number>(rawObject, 'getState_Rotation', 0));
		const geometry = createRectanglePolygonSnapshot(topLeft, width, height, rotation);
		output.push({
			primitiveId: getSyncState<string>(rawObject, 'getState_PrimitiveId', ''),
			layerId,
			topLeft,
			width,
			height,
			rotation,
			mirror: Boolean(getSyncState<boolean>(rawObject, 'getState_Mirror', false)),
			fileName: String(getSyncState<string>(rawObject, 'getState_FileName', '')),
			bbox: geometry.polygon.bbox,
			primitiveLock: Boolean(getSyncState<boolean>(rawObject, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readComponentSnapshots(netFilters: Set<string>, layerFilters: Set<number>): Promise<PcbComponentSnapshot[]> {
	const rawComponents = await eda.pcb_PrimitiveComponent.getAll();
	const output: PcbComponentSnapshot[] = [];
	for (const rawComponent of Array.isArray(rawComponents) ? rawComponents : []) {
		const layerId = Number(getSyncState<number>(rawComponent, 'getState_Layer', 0));
		if (!matchesLayerFilter(layerId, layerFilters)) {
			continue;
		}

		const pads = getSyncState<Array<{ primitiveId: string; net: string; padNumber: string }> | undefined>(rawComponent, 'getState_Pads', []) ?? [];
		if (netFilters.size > 0 && !pads.some(pad => matchesNetFilter(pad.net, netFilters))) {
			continue;
		}

		output.push({
			primitiveId: getSyncState<string>(rawComponent, 'getState_PrimitiveId', ''),
			layerId,
			position: {
				x: Number(getSyncState<number>(rawComponent, 'getState_X', 0)),
				y: Number(getSyncState<number>(rawComponent, 'getState_Y', 0)),
			},
			rotation: Number(getSyncState<number>(rawComponent, 'getState_Rotation', 0)),
			designator: getSyncState<string>(rawComponent, 'getState_Designator', ''),
			name: getSyncState<string>(rawComponent, 'getState_Name', ''),
			pads,
			primitiveLock: Boolean(getSyncState<boolean>(rawComponent, 'getState_PrimitiveLock', false)),
		});
	}
	return output;
}

async function readPadSnapshots(components: PcbComponentSnapshot[], netFilters: Set<string>, layerFilters: Set<number>): Promise<PcbPadSnapshot[]> {
	const output: PcbPadSnapshot[] = [];
	for (const component of components) {
		const rawPads = await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(component.primitiveId);
		for (const rawPad of Array.isArray(rawPads) ? rawPads : []) {
			const layerId = Number(getSyncState<number>(rawPad, 'getState_Layer', 0));
			const net = getSyncState<string | undefined>(rawPad, 'getState_Net', '') ?? '';
			if (!matchesLayerFilter(layerId, layerFilters) || !matchesNetFilter(net, netFilters)) {
				continue;
			}

			output.push({
				primitiveId: getSyncState<string>(rawPad, 'getState_PrimitiveId', ''),
				parentComponentPrimitiveId: component.primitiveId,
				net,
				layerId,
				padNumber: getSyncState<string>(rawPad, 'getState_PadNumber', ''),
				position: {
					x: Number(getSyncState<number>(rawPad, 'getState_X', 0)),
					y: Number(getSyncState<number>(rawPad, 'getState_Y', 0)),
				},
				rotation: Number(getSyncState<number>(rawPad, 'getState_Rotation', 0)),
				hole: getSyncState<unknown>(rawPad, 'getState_Hole', null),
				padShape: getSyncState<unknown>(rawPad, 'getState_Pad', null),
				primitiveLock: Boolean(getSyncState<boolean>(rawPad, 'getState_PrimitiveLock', false)),
			});
		}
	}
	return output;
}

function buildBoardOutlineSegments(lines: PcbLineSnapshot[], arcs: PcbArcSnapshot[]): PcbBoardOutlineSegmentSnapshot[] {
	return [
		...lines
			.filter(item => item.layerId === LAYER_BOARD_OUTLINE)
			.map(item => ({
				primitiveId: item.primitiveId,
				kind: 'line' as const,
				start: item.start,
				end: item.end,
				length: item.length,
			})),
		...arcs
			.filter(item => item.layerId === LAYER_BOARD_OUTLINE)
			.map(item => ({
				primitiveId: item.primitiveId,
				kind: 'arc' as const,
				start: item.start,
				end: item.end,
				arcAngle: item.arcAngle,
				length: item.length,
			})),
	];
}

function buildSnapshotSummary(
	copperLayerCount: number,
	layers: PcbLayerSnapshot[],
	lines: PcbLineSnapshot[],
	arcs: PcbArcSnapshot[],
	vias: PcbViaSnapshot[],
	pours: PcbPourSnapshot[],
	fills: PcbFillSnapshot[],
	regions: PcbRegionSnapshot[],
	images: PcbImageSnapshot[],
	objects: PcbObjectSnapshot[],
	components: PcbComponentSnapshot[],
	pads: PcbPadSnapshot[],
	boardOutlineSegments: PcbBoardOutlineSegmentSnapshot[],
): PcbSnapshotPayload['summary'] {
	return {
		copperLayerCount,
		objectCounts: {
			layers: layers.length,
			lines: lines.length,
			arcs: arcs.length,
			vias: vias.length,
			pours: pours.length,
			fills: fills.length,
			regions: regions.length,
			images: images.length,
			objects: objects.length,
			components: components.length,
			pads: pads.length,
			boardOutlineSegments: boardOutlineSegments.length,
		},
		nets: uniqueSortedStrings([
			...lines.map(item => item.net),
			...arcs.map(item => item.net),
			...vias.map(item => item.net),
			...pours.map(item => item.net),
			...fills.map(item => item.net),
			...pads.map(item => item.net),
		]),
	};
}

async function buildSnapshotPayload(request: PcbSnapshotRequest): Promise<{ warnings: string[]; snapshot: PcbSnapshotPayload }> {
	const pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
	if (!pcbInfo) {
		throw new Error('当前未检测到活动 PCB 页面，无法读取 PCB 几何关系快照。');
	}

	const warnings: string[] = [];
	const include = normalizeIncludeOptions(request.include);
	const netFilters = toFilterSet(request.nets ?? []);
	const layerFilters = toLayerFilterSet(request.layerIds ?? []);
	const copperLayerCountRaw = await eda.pcb_Layer.getTheNumberOfCopperLayers();
	const copperLayerCount = typeof copperLayerCountRaw === 'number' && Number.isFinite(copperLayerCountRaw)
		? copperLayerCountRaw
		: 2;
	const copperLayerOrder = buildCopperLayerOrder(copperLayerCount);
	const copperOrderIndexMap = buildOrderIndexMap(copperLayerOrder);
	const needsLineSnapshots = include.lines || include.boardOutline;
	const needsArcSnapshots = include.arcs || include.boardOutline;

	const [rawLayers, rawLines, rawArcs, vias, pours, fills, regions, images, objects, components] = await Promise.all([
		include.layers ? readLayerSnapshot(copperOrderIndexMap) : Promise.resolve([]),
		needsLineSnapshots ? readLineSnapshots(netFilters, layerFilters) : Promise.resolve([]),
		needsArcSnapshots ? readArcSnapshots(netFilters, layerFilters) : Promise.resolve([]),
		include.vias ? readViaSnapshots(netFilters) : Promise.resolve([]),
		include.pours ? readPourSnapshots(netFilters, layerFilters) : Promise.resolve([]),
		include.fills ? readFillSnapshots(netFilters, layerFilters) : Promise.resolve([]),
		include.regions ? readRegionSnapshots(layerFilters) : Promise.resolve([]),
		include.images ? readImageSnapshots(layerFilters) : Promise.resolve([]),
		include.objects ? readObjectSnapshots(layerFilters) : Promise.resolve([]),
		include.components ? readComponentSnapshots(netFilters, layerFilters) : Promise.resolve([]),
	]);
	const pads = include.pads ? await readPadSnapshots(components, netFilters, layerFilters) : [];
	const boardOutlineSegments = include.boardOutline ? buildBoardOutlineSegments(rawLines, rawArcs) : [];

	const lines = include.lines ? rawLines.filter(item => item.layerId !== LAYER_BOARD_OUTLINE) : [];
	const arcs = include.arcs ? rawArcs.filter(item => item.layerId !== LAYER_BOARD_OUTLINE) : [];
	if (include.boardOutline && boardOutlineSegments.length === 0) {
		warnings.push('未读取到板框图元，board_edge_clearance 分析可能为空。');
	}

	return {
		warnings,
		snapshot: {
			pcbId: String((pcbInfo as { uuid?: string }).uuid ?? ''),
			pcbName: String((pcbInfo as { name?: string }).name ?? ''),
			parentProjectUuid: String((pcbInfo as { parentProjectUuid?: string }).parentProjectUuid ?? ''),
			parentBoardName: String((pcbInfo as { parentBoardName?: string }).parentBoardName ?? ''),
			unitSystem: 'editor-coordinate',
			layers: rawLayers,
			lines,
			arcs,
			vias,
			pours,
			fills,
			regions,
			images,
			objects,
			components,
			pads,
			boardOutlineSegments,
			summary: buildSnapshotSummary(copperLayerCount, rawLayers, lines, arcs, vias, pours, fills, regions, images, objects, components, pads, boardOutlineSegments),
		},
	};
}

function getAdjacentCopperLayers(layerId: number, orderedCopperLayers: number[]): number[] {
	const index = orderedCopperLayers.indexOf(layerId);
	if (index < 0) {
		return [];
	}

	const output: number[] = [];
	if (index - 1 >= 0) {
		output.push(orderedCopperLayers[index - 1]);
	}
	if (index + 1 < orderedCopperLayers.length) {
		output.push(orderedCopperLayers[index + 1]);
	}
	return output;
}

function buildNetStatsFeatures(
	lines: PcbLineSnapshot[],
	arcs: PcbArcSnapshot[],
	vias: PcbViaSnapshot[],
	pads: PcbPadSnapshot[],
	components: PcbComponentSnapshot[],
	netFilters: Set<string>,
): PcbGeometryFeature[] {
	const traceLike = [...lines, ...arcs];
	const nets = uniqueSortedStrings([
		...traceLike.map(item => item.net),
		...vias.map(item => item.net),
		...pads.map(item => item.net),
	]).filter(net => matchesNetFilter(net, netFilters));
	const componentMap = new Map(components.map(component => [component.primitiveId, component]));

	return nets.map((net) => {
		const netTraces = traceLike.filter(item => item.net === net);
		const netVias = vias.filter(item => item.net === net);
		const netPads = pads.filter(item => item.net === net);
		const graph = buildNetGraph(netTraces, netVias, netPads);
		const totalTrackLength = netTraces.reduce((sum, item) => sum + item.length, 0);
		const mainPathLengthEstimate = estimateMainPathLength(graph);
		const stubStats = estimateStubStats(graph);
		const routeBoundingBox = mergeBoundingBoxes([
			...netTraces.map(item => item.bbox),
			...netVias.map(item => createPointBoundingBox(item.position)),
			...netPads.map(item => createPointBoundingBox(item.position)),
		]);
		const layerIds = uniqueSortedNumbers(netTraces.map(item => item.layerId));
		const layerTransitionCount = netVias.length;
		const branchLengthEstimate = Math.max(0, totalTrackLength - mainPathLengthEstimate);
		const padEndpoints = buildPadEndpoints(netPads, componentMap);

		return {
			featureId: `feature:net-path-stats:${net}`,
			featureType: 'net_path_stats',
			subjectKind: 'net',
			subjectId: net,
			values: {
				totalTrackLength,
				lineCount: lines.filter(item => item.net === net).length,
				arcCount: arcs.filter(item => item.net === net).length,
				viaCount: netVias.length,
				layerIds,
				layerTransitionCount,
				whetherLayerTransitionExists: layerTransitionCount > 0 || layerIds.length > 1,
				padEndpointCount: padEndpoints.length,
				padEndpoints,
				routeBoundingBox,
				connectedComponentCount: countConnectedComponents(graph),
				mainPathLengthEstimate,
				branchLengthEstimate,
				stubCount: stubStats.stubCount,
				stubLengthEstimate: stubStats.stubLengthEstimate,
				whetherStubLikelyExists: stubStats.stubLengthEstimate > 0,
			},
			evidence: {
				tracePrimitiveIds: netTraces.map(item => item.primitiveId),
				viaPrimitiveIds: netVias.map(item => item.primitiveId),
				padPrimitiveIds: netPads.map(item => item.primitiveId),
				graphNodeCount: graph.nodes.size,
				graphEdgeCount: graph.edges.size,
			},
		};
	});
}

function buildLoopAreaProxyFeatures(
	lines: PcbLineSnapshot[],
	arcs: PcbArcSnapshot[],
	vias: PcbViaSnapshot[],
	pads: PcbPadSnapshot[],
	netFilters: Set<string>,
): PcbGeometryFeature[] {
	const traceLike = [...lines, ...arcs];
	const nets = uniqueSortedStrings([
		...traceLike.map(item => item.net),
		...vias.map(item => item.net),
		...pads.map(item => item.net),
	]).filter(net => matchesNetFilter(net, netFilters));

	return nets.flatMap((net) => {
		const netTraces = traceLike.filter(item => item.net === net);
		const netVias = vias.filter(item => item.net === net);
		const netPads = pads.filter(item => item.net === net);
		const graph = buildNetGraph(netTraces, netVias, netPads);
		const loopProxy = estimateLoopAreaProxy(graph);
		if (loopProxy.mainPathNodeKeys.length < 2) {
			return [];
		}

		return [{
			featureId: `feature:net-loop-area-proxy:${net}`,
			featureType: 'net_loop_area_proxy',
			subjectKind: 'net',
			subjectId: net,
			values: {
				projectedLoopAreaProxy: loopProxy.projectedLoopAreaProxy,
				mainPathNodeCount: loopProxy.mainPathNodeKeys.length,
				padEndpointCount: netPads.length,
			},
			evidence: {
				mainPathNodeKeys: loopProxy.mainPathNodeKeys,
				tracePrimitiveIds: netTraces.map(item => item.primitiveId),
				padPrimitiveIds: netPads.map(item => item.primitiveId),
			},
		}];
	});
}

function buildSpatialRelationsFeatures(
	traces: TraceSnapshot[],
	snapshot: Pick<PcbSnapshotPayload, 'pours' | 'fills' | 'regions' | 'images' | 'objects'>,
	objectKinds: Set<PcbSpatialObjectKind>,
	sampleStep: number,
): { relations: PcbGeometryRelation[]; features: PcbGeometryFeature[] } {
	const relations: PcbGeometryRelation[] = [];
	const features: PcbGeometryFeature[] = [];
	const spatialObjects = buildSpatialObjects(snapshot, objectKinds);

	for (const trace of traces) {
		const tracePoints = traceToPoints(trace, sampleStep);
		let nearest: { object: SpatialObjectSnapshot; minDistance: number } | null = null;

		for (const object of spatialObjects) {
			const minDistance = object.polygons.length === 0
				? null
				: Math.min(...object.polygons
						.map(polygon => distancePolylineToPolygon(tracePoints, polygon))
						.filter((value): value is number => value != null));
			if (minDistance == null || !Number.isFinite(minDistance)) {
				continue;
			}

			const currentSameLayer = nearest?.object.layerId === trace.layerId;
			const candidateSameLayer = object.layerId === trace.layerId;
			if (nearest == null
				|| minDistance < nearest.minDistance
				|| (Math.abs(minDistance - nearest.minDistance) <= 1e-6 && candidateSameLayer && !currentSameLayer)) {
				nearest = { object, minDistance };
			}

			const overlapsProjection = object.polygons.some(polygon => polylineIntersectsPolygon(tracePoints, polygon));
			if (overlapsProjection) {
				relations.push({
					relationId: `relation:trace-object-overlap:${trace.primitiveId}:${object.objectKind}:${object.objectId}`,
					relationType: 'trace_overlaps_object_projection',
					sourceKind: 'trace',
					sourceId: trace.primitiveId,
					targetKind: object.objectKind,
					targetId: object.objectId,
					attributes: {
						objectLayerId: object.layerId,
						objectNet: object.net,
						approximateArea: object.approximateArea,
					},
				});
				if (object.objectKind === 'region') {
					relations.push({
						relationId: `relation:trace-region-rule-overlap:${trace.primitiveId}:${object.objectId}`,
						relationType: 'trace_intersects_rule_region_projection',
						sourceKind: 'trace',
						sourceId: trace.primitiveId,
						targetKind: 'region',
						targetId: object.objectId,
						attributes: {
							ruleTypes: object.attributes.ruleTypes,
							regionName: object.attributes.regionName,
						},
					});
				}
			}
		}

		if (nearest) {
			features.push({
				featureId: `feature:trace-nearest-spatial-object:${trace.primitiveId}`,
				featureType: 'trace_nearest_spatial_object_clearance',
				subjectKind: 'trace',
				subjectId: trace.primitiveId,
				values: {
					objectKind: nearest.object.objectKind,
					objectId: nearest.object.objectId,
					objectLayerId: nearest.object.layerId,
					objectNet: nearest.object.net,
					minDistance: nearest.minDistance,
				},
				evidence: {
					traceNet: trace.net,
					traceLayerId: trace.layerId,
				},
			});
		}
	}

	return { relations, features };
}

function buildReferenceGroundingFeatures(
	traces: TraceSnapshot[],
	pours: PcbPourSnapshot[],
	boardOutlineSegments: PcbBoardOutlineSegmentSnapshot[],
	copperLayers: number[],
	referenceNetNames: Set<string>,
	sampleStep: number,
): { relations: PcbGeometryRelation[]; features: PcbGeometryFeature[] } {
	const relations: PcbGeometryRelation[] = [];
	const features: PcbGeometryFeature[] = [];
	const referenceIslands = pours
		.filter(item => referenceNetNames.has(item.net.toUpperCase()))
		.flatMap<ReferenceIslandSnapshot>((pour) => {
			const regions = pour.filledRegions.length > 0
				? pour.filledRegions
				: [{
					fillId: 'boundary',
					approximateArea: 0,
					polygon: pour.polygon,
				} satisfies PcbPourFilledRegionSnapshot];
			return regions.map(region => ({
				islandId: `${pour.primitiveId}:${region.fillId}`,
				layerId: pour.layerId,
				net: pour.net,
				pourPrimitiveId: pour.primitiveId,
				bbox: region.polygon.bbox,
				approximateArea: region.approximateArea,
				points: polygonSourceToPoints(region.polygon.source, sampleStep),
			})).filter(item => item.points.length >= 3);
		});

	for (const trace of traces) {
		const adjacentLayers = getAdjacentCopperLayers(trace.layerId, copperLayers);
		const samples = 'arcAngle' in trace
			? sampleArc(trace.start, trace.end, trace.arcAngle, sampleStep)
			: sampleLine(trace.start, trace.end, sampleStep);
		const referenceLayers = adjacentLayers
			.map(referenceLayerId => ({
				referenceLayerId,
				relevantIslands: referenceIslands.filter(item => item.layerId === referenceLayerId),
			}))
			.filter(item => item.relevantIslands.length > 0);

		if (referenceLayers.length === 0) {
			features.push({
				featureId: `feature:trace-reference-ground:${trace.primitiveId}:none`,
				featureType: 'trace_reference_ground_coverage',
				subjectKind: 'trace',
				subjectId: trace.primitiveId,
				values: {
					traceLayerId: trace.layerId,
					referenceLayerId: null,
					referenceNetNames: Array.from(referenceNetNames.values()),
					hasAdjacentReferenceLayer: false,
					referenceIslandCount: 0,
					referenceIslandIdsSeen: [],
					coveredIslandIds: [],
					sampledIslandSequence: [],
					sampleCount: samples.length,
					supportedSampleCount: 0,
					coverageRatio: 0,
					planeSplitCrossingCount: 0,
				},
				evidence: {
					traceNet: trace.net,
					tracePrimitiveId: trace.primitiveId,
					adjacentCopperLayerIds: adjacentLayers,
					unsupportedSampleSegments: samples.length >= 2
						? [{
								startSampleIndex: 0,
								endSampleIndex: samples.length - 1,
								startPoint: samples[0],
								endPoint: samples[samples.length - 1],
								lengthEstimate: distanceBetweenPoints(samples[0], samples[samples.length - 1]),
							}]
						: [],
				},
			});
		}

		for (const { referenceLayerId, relevantIslands } of referenceLayers) {
			relations.push({
				relationId: `relation:trace-layer:${trace.primitiveId}:${referenceLayerId}`,
				relationType: 'trace_references_adjacent_copper_layer',
				sourceKind: 'trace',
				sourceId: trace.primitiveId,
				targetKind: 'layer',
				targetId: String(referenceLayerId),
				attributes: {
					traceLayerId: trace.layerId,
					referenceLayerId,
				},
			});

			const sampledIslandIds = samples.map(sample => relevantIslands.find(island => pointInPolygon(sample, island.points))?.islandId ?? null);
			const supportedSampleCount = sampledIslandIds.filter(item => item != null).length;
			const coverageRatio = samples.length === 0 ? 0 : supportedSampleCount / samples.length;
			const compressedSequence = compressNullableSequence(sampledIslandIds);
			const referenceIslandIdsSeen = uniqueSortedStrings(sampledIslandIds.filter((item): item is string => item != null));
			const planeSplitCrossingCount = countSequenceTransitions(compressedSequence);

			features.push({
				featureId: `feature:trace-reference-ground:${trace.primitiveId}:${referenceLayerId}`,
				featureType: 'trace_reference_ground_coverage',
				subjectKind: 'trace',
				subjectId: trace.primitiveId,
				values: {
					traceLayerId: trace.layerId,
					referenceLayerId,
					referenceNetNames: Array.from(referenceNetNames.values()),
					hasAdjacentReferenceLayer: true,
					referenceIslandCount: relevantIslands.length,
					referenceIslandIdsSeen,
					coveredIslandIds: referenceIslandIdsSeen,
					sampledIslandSequence: compressedSequence,
					sampleCount: samples.length,
					supportedSampleCount,
					coverageRatio,
					planeSplitCrossingCount,
				},
				evidence: {
					traceNet: trace.net,
					tracePrimitiveId: trace.primitiveId,
					referencePourPrimitiveIds: uniqueSortedStrings(relevantIslands.map(item => item.pourPrimitiveId)),
					unsupportedSampleSegments: buildUnsupportedSampleSegments(samples, sampledIslandIds),
				},
			});

			if (coverageRatio > 0) {
				relations.push({
					relationId: `relation:trace-pour:${trace.primitiveId}:${referenceLayerId}`,
					relationType: 'trace_projects_over_reference_pour',
					sourceKind: 'trace',
					sourceId: trace.primitiveId,
					targetKind: 'layer',
					targetId: String(referenceLayerId),
					attributes: {
						coverageRatio,
						referencePourPrimitiveIds: uniqueSortedStrings(relevantIslands.map(item => item.pourPrimitiveId)),
						referenceIslandIdsSeen,
					},
				});
			}

			if (planeSplitCrossingCount > 0) {
				relations.push({
					relationId: `relation:trace-plane-split:${trace.primitiveId}:${referenceLayerId}`,
					relationType: 'trace_crosses_reference_plane_split',
					sourceKind: 'trace',
					sourceId: trace.primitiveId,
					targetKind: 'layer',
					targetId: String(referenceLayerId),
					attributes: {
						planeSplitCrossingCount,
						referenceIslandIdsSeen,
					},
				});
			}
		}

		const edgeDistances = samples
			.map(point => distancePointToBoardOutline(point, boardOutlineSegments, sampleStep))
			.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
		if (edgeDistances.length > 0) {
			features.push({
				featureId: `feature:trace-board-edge:${trace.primitiveId}`,
				featureType: 'trace_board_edge_clearance',
				subjectKind: 'trace',
				subjectId: trace.primitiveId,
				values: {
					traceLayerId: trace.layerId,
					minClearance: Math.min(...edgeDistances),
				},
				evidence: {
					traceNet: trace.net,
					boardOutlineSegmentCount: boardOutlineSegments.length,
				},
			});
		}
	}

	return { relations, features };
}

function buildReturnViaClearanceFeatures(
	vias: PcbViaSnapshot[],
	referenceNetNames: Set<string>,
	netFilters: Set<string>,
): { relations: PcbGeometryRelation[]; features: PcbGeometryFeature[] } {
	const relations: PcbGeometryRelation[] = [];
	const features: PcbGeometryFeature[] = [];
	const referenceVias = vias.filter(via => referenceNetNames.has(via.net.toUpperCase()));
	const signalVias = vias.filter(via => !referenceNetNames.has(via.net.toUpperCase()) && matchesNetFilter(via.net, netFilters));
	const groupedDistances = new Map<string, Array<{ viaId: string; distance: number }>>();

	for (const via of signalVias) {
		const nearestReferenceVia = referenceVias
			.map(referenceVia => ({
				referenceVia,
				distance: distanceBetweenPoints(via.position, referenceVia.position),
			}))
			.sort((a, b) => a.distance - b.distance)[0];
		if (!nearestReferenceVia) {
			continue;
		}

		features.push({
			featureId: `feature:signal-via-reference-via:${via.primitiveId}`,
			featureType: 'signal_via_reference_via_clearance',
			subjectKind: 'via',
			subjectId: via.primitiveId,
			values: {
				net: via.net,
				minReferenceViaDistance: nearestReferenceVia.distance,
				nearestReferenceViaId: nearestReferenceVia.referenceVia.primitiveId,
				nearestReferenceViaNet: nearestReferenceVia.referenceVia.net,
			},
			evidence: {
				signalViaPrimitiveId: via.primitiveId,
				referenceViaPrimitiveId: nearestReferenceVia.referenceVia.primitiveId,
			},
		});
		relations.push({
			relationId: `relation:signal-via-reference-via:${via.primitiveId}:${nearestReferenceVia.referenceVia.primitiveId}`,
			relationType: 'signal_via_nearest_reference_via',
			sourceKind: 'via',
			sourceId: via.primitiveId,
			targetKind: 'via',
			targetId: nearestReferenceVia.referenceVia.primitiveId,
			attributes: {
				distance: nearestReferenceVia.distance,
			},
		});

		const bucket = groupedDistances.get(via.net) ?? [];
		bucket.push({ viaId: via.primitiveId, distance: nearestReferenceVia.distance });
		groupedDistances.set(via.net, bucket);
	}

	for (const [net, items] of groupedDistances.entries()) {
		const distances = items.map(item => item.distance);
		features.push({
			featureId: `feature:net-reference-via-clearance:${net}`,
			featureType: 'net_reference_via_clearance_summary',
			subjectKind: 'net',
			subjectId: net,
			values: {
				signalViaCount: items.length,
				minReferenceViaDistance: Math.min(...distances),
				maxReferenceViaDistance: Math.max(...distances),
				avgReferenceViaDistance: distances.reduce((sum, value) => sum + value, 0) / distances.length,
			},
			evidence: {
				signalViaPrimitiveIds: items.map(item => item.viaId),
			},
		});
	}

	return { relations, features };
}

function buildPlaneConnectivityFeatures(
	pours: PcbPourSnapshot[],
	netFilters: Set<string>,
): { relations: PcbGeometryRelation[]; features: PcbGeometryFeature[] } {
	const relations: PcbGeometryRelation[] = [];
	const features: PcbGeometryFeature[] = [];
	const grouped = new Map<string, {
		net: string;
		layerId: number;
		preserveSilos: boolean;
		regionCount: number;
		totalFilledArea: number;
		dominantIsland: PcbPourFilledRegionSnapshot | null;
		dominantPourPrimitiveId: string | null;
	}>();

	for (const pour of pours) {
		if (!matchesNetFilter(pour.net, netFilters)) {
			continue;
		}
		const key = `${pour.net}:${pour.layerId}`;
		const bucket = grouped.get(key) ?? {
			net: pour.net,
			layerId: pour.layerId,
			preserveSilos: false,
			regionCount: 0,
			totalFilledArea: 0,
			dominantIsland: null,
			dominantPourPrimitiveId: null,
		};
		bucket.preserveSilos = bucket.preserveSilos || pour.preserveSilos;
		const regions = pour.filledRegions.length > 0
			? pour.filledRegions
			: [{
				fillId: 'boundary',
				approximateArea: estimatePolygonArea(polygonSourceToPoints(pour.polygon.source)),
				polygon: pour.polygon,
			} satisfies PcbPourFilledRegionSnapshot];
		for (const region of regions) {
			bucket.regionCount += 1;
			bucket.totalFilledArea += region.approximateArea;
			if ((bucket.dominantIsland?.approximateArea ?? -1) < region.approximateArea) {
				bucket.dominantIsland = region;
				bucket.dominantPourPrimitiveId = pour.primitiveId;
			}
			relations.push({
				relationId: `relation:net-layer-island:${pour.net}:${pour.layerId}:${region.fillId}`,
				relationType: 'net_layer_has_copper_island',
				sourceKind: 'net',
				sourceId: pour.net,
				targetKind: 'layer',
				targetId: String(pour.layerId),
				attributes: {
					pourPrimitiveId: pour.primitiveId,
					fillId: region.fillId,
					approximateArea: region.approximateArea,
					bbox: region.polygon.bbox,
				},
			});
		}
		grouped.set(key, bucket);
	}

	for (const bucket of grouped.values()) {
		features.push({
			featureId: `feature:plane-connectivity:${bucket.net}:${bucket.layerId}`,
			featureType: 'plane_connectivity_summary',
			subjectKind: 'net',
			subjectId: bucket.net,
			values: {
				layerId: bucket.layerId,
				connectedIslandCount: bucket.regionCount,
				fillRegionCount: bucket.regionCount,
				approximateFilledArea: bucket.totalFilledArea,
				totalFilledArea: bucket.totalFilledArea,
				isFragmented: bucket.regionCount > 1,
				preserveSilos: bucket.preserveSilos,
				dominantIslandArea: bucket.dominantIsland?.approximateArea ?? 0,
				dominantIslandBBox: bucket.dominantIsland?.polygon.bbox ?? null,
			},
			evidence: {
				dominantPourPrimitiveId: bucket.dominantPourPrimitiveId,
			},
		});
	}

	return { relations, features };
}

function buildAnalyzeSnapshotRequest(request: PcbAnalyzeRequest, analysisModes: PcbGeometryAnalysisMode[]): PcbSnapshotRequest {
	const include = normalizeIncludeOptions(request.include);
	if (analysisModes.includes('net_stats')) {
		include.lines = true;
		include.arcs = true;
		include.pads = true;
		include.components = true;
		include.vias = true;
	}
	if (analysisModes.includes('reference_grounding')) {
		include.lines = true;
		include.arcs = true;
		include.layers = true;
		include.pours = true;
	}
	if (analysisModes.includes('board_edge_clearance')) {
		include.lines = true;
		include.arcs = true;
		include.boardOutline = true;
	}
	if (analysisModes.includes('return_via_clearance')) {
		include.vias = true;
	}
	if (analysisModes.includes('plane_connectivity')) {
		include.pours = true;
	}
	if (analysisModes.includes('loop_area_proxy')) {
		include.lines = true;
		include.arcs = true;
		include.vias = true;
		include.pads = true;
	}
	if (analysisModes.includes('spatial_relations')) {
		include.lines = true;
		include.arcs = true;
		const objectKinds = normalizeSpatialObjectKinds(request.spatialObjectKinds);
		include.pours = include.pours || objectKinds.has('pour');
		include.fills = include.fills || objectKinds.has('fill');
		include.regions = include.regions || objectKinds.has('region');
		include.images = include.images || objectKinds.has('image');
		include.objects = include.objects || objectKinds.has('object');
	}

	const effectiveReferenceNets = request.referenceNetNames?.length ? request.referenceNetNames : DEFAULT_REFERENCE_NET_NAMES;
	const shouldExpandNets = request.nets?.length
		&& (analysisModes.includes('reference_grounding') || analysisModes.includes('return_via_clearance'));

	return {
		nets: shouldExpandNets ? uniqueSortedStrings([...(request.nets ?? []), ...effectiveReferenceNets]) : request.nets,
		layerIds: request.layerIds,
		include,
	};
}

async function buildAnalyzeResponse(request: PcbAnalyzeRequest, metadata: PcbEnginePluginMetadata): Promise<PcbAnalyzeResponse> {
	const analysisModes = request.analysisModes ?? [...PCB_GEOMETRY_ANALYSIS_MODES];
	const snapshotRequest = buildAnalyzeSnapshotRequest(request, analysisModes);
	const { warnings, snapshot } = await buildSnapshotPayload(snapshotRequest);
	const traceIdFilter = new Set(request.tracePrimitiveIds ?? []);
	const requestedNetFilters = toFilterSet(request.nets ?? []);
	const effectiveReferenceNetNames = toFilterSet((request.referenceNetNames?.length ? request.referenceNetNames : DEFAULT_REFERENCE_NET_NAMES));
	const filteredLines = snapshot.lines.filter(trace =>
		(traceIdFilter.size === 0 || traceIdFilter.has(trace.primitiveId))
		&& matchesNetFilter(trace.net, requestedNetFilters));
	const filteredArcs = snapshot.arcs.filter(trace =>
		(traceIdFilter.size === 0 || traceIdFilter.has(trace.primitiveId))
		&& matchesNetFilter(trace.net, requestedNetFilters));
	const traces = [...filteredLines, ...filteredArcs];
	const signalVias = snapshot.vias.filter(via =>
		!effectiveReferenceNetNames.has(via.net.toUpperCase())
		&& matchesNetFilter(via.net, requestedNetFilters));
	const spatialObjectKinds = normalizeSpatialObjectKinds(request.spatialObjectKinds);
	const copperLayers = snapshot.layers
		.filter(item => item.isCopperLayer && item.orderIndex != null)
		.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
		.map(item => item.layerId);

	const features: PcbGeometryFeature[] = [];
	const relations: PcbGeometryRelation[] = [];
	if (analysisModes.includes('net_stats')) {
		features.push(...buildNetStatsFeatures(filteredLines, filteredArcs, snapshot.vias, snapshot.pads, snapshot.components, requestedNetFilters));
	}

	if (analysisModes.includes('reference_grounding') || analysisModes.includes('board_edge_clearance')) {
		const grounding = buildReferenceGroundingFeatures(
			traces,
			snapshot.pours,
			snapshot.boardOutlineSegments,
			copperLayers,
			effectiveReferenceNetNames,
			request.sampleStep ?? DEFAULT_SAMPLE_STEP,
		);
		if (analysisModes.includes('reference_grounding')) {
			features.push(...grounding.features.filter(item => item.featureType === 'trace_reference_ground_coverage'));
			relations.push(...grounding.relations.filter(item =>
				item.relationType === 'trace_references_adjacent_copper_layer'
				|| item.relationType === 'trace_projects_over_reference_pour'
				|| item.relationType === 'trace_crosses_reference_plane_split'));
		}
		if (analysisModes.includes('board_edge_clearance')) {
			features.push(...grounding.features.filter(item => item.featureType === 'trace_board_edge_clearance'));
		}
	}

	if (analysisModes.includes('return_via_clearance')) {
		const viaClearance = buildReturnViaClearanceFeatures(snapshot.vias, effectiveReferenceNetNames, requestedNetFilters);
		features.push(...viaClearance.features);
		relations.push(...viaClearance.relations);
	}

	if (analysisModes.includes('plane_connectivity')) {
		const planeConnectivity = buildPlaneConnectivityFeatures(snapshot.pours, requestedNetFilters);
		features.push(...planeConnectivity.features);
		relations.push(...planeConnectivity.relations);
	}

	if (analysisModes.includes('loop_area_proxy')) {
		features.push(...buildLoopAreaProxyFeatures(filteredLines, filteredArcs, snapshot.vias, snapshot.pads, requestedNetFilters));
	}

	if (analysisModes.includes('spatial_relations')) {
		const spatialRelations = buildSpatialRelationsFeatures(
			traces,
			snapshot,
			spatialObjectKinds,
			request.sampleStep ?? DEFAULT_SAMPLE_STEP,
		);
		features.push(...spatialRelations.features);
		relations.push(...spatialRelations.relations);
	}

	const traceModes = new Set<PcbGeometryAnalysisMode>([
		'net_stats',
		'reference_grounding',
		'board_edge_clearance',
		'loop_area_proxy',
		'spatial_relations',
	]);
	const traceCountAnalyzed = analysisModes.some(mode => traceModes.has(mode)) ? traces.length : 0;
	const objectCountAnalyzed = analysisModes.includes('spatial_relations')
		? buildSpatialObjects(snapshot, spatialObjectKinds).length
		: 0;

	return {
		ok: true,
		plugin: metadata,
		generatedAt: new Date().toISOString(),
		warnings,
		analysisModes,
		summary: {
			traceCountAnalyzed,
			viaCountAnalyzed: analysisModes.includes('return_via_clearance') ? signalVias.length : 0,
			objectCountAnalyzed,
			netCountAnalyzed: uniqueSortedStrings(features.map(item => item.subjectKind === 'net' ? item.subjectId : '')).length,
			relationCount: relations.length,
			featureCount: features.length,
		},
		relations,
		features,
		snapshot: request.includeSnapshot ? snapshot : undefined,
	};
}

class PcbGeometryEnginePlugin implements BridgePlugin {
	public readonly metadata: PcbEnginePluginMetadata = {
		id: PCB_GEOMETRY_ENGINE_PLUGIN_ID,
		version: PCB_GEOMETRY_ENGINE_PLUGIN_VERSION,
		displayName: 'PCB Geometry Relation Engine',
	};

	public async execute(action: string, payload: unknown): Promise<unknown> {
		switch (action) {
			case 'snapshot':
				return await this.handleSnapshot(payload);
			case 'analyze':
				return await this.handleAnalyze(payload);
			default:
				throw new Error(`插件 ${this.metadata.id} 不支持 action=${action}。`);
		}
	}

	private async handleSnapshot(payload: unknown): Promise<PcbSnapshotResponse> {
		const request = normalizeSnapshotRequest(payload);
		const { warnings, snapshot } = await buildSnapshotPayload(request);
		return {
			ok: true,
			plugin: this.metadata,
			generatedAt: new Date().toISOString(),
			warnings,
			snapshot,
		};
	}

	private async handleAnalyze(payload: unknown): Promise<PcbAnalyzeResponse> {
		const request = normalizeAnalyzeRequest(payload);
		return await buildAnalyzeResponse(request, this.metadata);
	}
}

export const pcbGeometryEnginePlugin = new PcbGeometryEnginePlugin();
