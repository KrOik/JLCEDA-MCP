import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pcbGeometryEnginePlugin } from './plugin.ts';

function createPolygon(source: Array<'L' | 'ARC' | 'CARC' | 'C' | 'R' | 'CIRCLE' | number>) {
	return {
		getSource: () => source,
	};
}

function createPourFill(id: string, source: Array<'L' | 'ARC' | 'CARC' | 'C' | 'R' | 'CIRCLE' | number>) {
	return {
		id,
		lineWidth: 0.2,
		fill: true,
		path: createPolygon(source),
	};
}

function createPrimitive<T extends Record<string, unknown>>(state: T): T & { toSync: () => T } {
	return {
		...state,
		toSync() {
			return this as unknown as T;
		},
	};
}

function installPcbEdaMock(): void {
	(globalThis as typeof globalThis & { eda?: unknown }).eda = {
		dmt_Pcb: {
			getCurrentPcbInfo: vi.fn().mockResolvedValue({
				uuid: 'pcb-1',
				name: 'Main Board',
				parentProjectUuid: 'project-1',
				parentBoardName: 'Control Board',
			}),
		},
		pcb_Layer: {
			getTheNumberOfCopperLayers: vi.fn().mockResolvedValue(4),
			getAllLayers: vi.fn().mockResolvedValue([
				{ id: 1, name: 'TopLayer', type: 'SIGNAL', layerStatus: 'VISIBLE', locked: false },
				{ id: 15, name: 'Inner1', type: 'INTERNAL_ELECTRICAL', layerStatus: 'VISIBLE', locked: false },
				{ id: 16, name: 'Inner2', type: 'INTERNAL_ELECTRICAL', layerStatus: 'VISIBLE', locked: false },
				{ id: 2, name: 'BottomLayer', type: 'SIGNAL', layerStatus: 'VISIBLE', locked: false },
				{ id: 11, name: 'BoardOutline', type: 'OTHER', layerStatus: 'VISIBLE', locked: false },
			]),
		},
		pcb_PrimitiveLine: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'track-1a',
					getState_Net: () => 'CLK',
					getState_Layer: () => 1,
					getState_StartX: () => 10,
					getState_StartY: () => 10,
					getState_EndX: () => 50,
					getState_EndY: () => 10,
					getState_LineWidth: () => 0.2,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'track-1b',
					getState_Net: () => 'CLK',
					getState_Layer: () => 1,
					getState_StartX: () => 50,
					getState_StartY: () => 10,
					getState_EndX: () => 50,
					getState_EndY: () => 20,
					getState_LineWidth: () => 0.2,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'track-1c',
					getState_Net: () => 'CLK',
					getState_Layer: () => 1,
					getState_StartX: () => 50,
					getState_StartY: () => 20,
					getState_EndX: () => 90,
					getState_EndY: () => 20,
					getState_LineWidth: () => 0.2,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'stub-1',
					getState_Net: () => 'CLK',
					getState_Layer: () => 1,
					getState_StartX: () => 70,
					getState_StartY: () => 20,
					getState_EndX: () => 70,
					getState_EndY: () => 30,
					getState_LineWidth: () => 0.2,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'outline-top',
					getState_Net: () => '',
					getState_Layer: () => 11,
					getState_StartX: () => 0,
					getState_StartY: () => 0,
					getState_EndX: () => 100,
					getState_EndY: () => 0,
					getState_LineWidth: () => 0.1,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'outline-right',
					getState_Net: () => '',
					getState_Layer: () => 11,
					getState_StartX: () => 100,
					getState_StartY: () => 0,
					getState_EndX: () => 100,
					getState_EndY: () => 60,
					getState_LineWidth: () => 0.1,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'outline-bottom',
					getState_Net: () => '',
					getState_Layer: () => 11,
					getState_StartX: () => 100,
					getState_StartY: () => 60,
					getState_EndX: () => 0,
					getState_EndY: () => 60,
					getState_LineWidth: () => 0.1,
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'outline-left',
					getState_Net: () => '',
					getState_Layer: () => 11,
					getState_StartX: () => 0,
					getState_StartY: () => 60,
					getState_EndX: () => 0,
					getState_EndY: () => 0,
					getState_LineWidth: () => 0.1,
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitiveArc: {
			getAll: vi.fn().mockResolvedValue([]),
		},
		pcb_PrimitiveVia: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'via-signal-1',
					getState_Net: () => 'CLK',
					getState_X: () => 50,
					getState_Y: () => 10,
					getState_HoleDiameter: () => 0.2,
					getState_Diameter: () => 0.45,
					getState_ViaType: () => 'NORMAL',
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'via-gnd-1',
					getState_Net: () => 'GND',
					getState_X: () => 50,
					getState_Y: () => 14,
					getState_HoleDiameter: () => 0.2,
					getState_Diameter: () => 0.45,
					getState_ViaType: () => 'NORMAL',
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'via-gnd-2',
					getState_Net: () => 'GND',
					getState_X: () => 20,
					getState_Y: () => 40,
					getState_HoleDiameter: () => 0.2,
					getState_Diameter: () => 0.45,
					getState_ViaType: () => 'NORMAL',
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitivePour: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'pour-gnd-inner1',
					getState_Net: () => 'GND',
					getState_Layer: () => 15,
					getState_PourName: () => 'GND_REF',
					getState_PourPriority: () => 1,
					getState_LineWidth: () => 0.2,
					getState_PreserveSilos: () => true,
					getState_ComplexPolygon: () => createPolygon(['R', 0, 0, 100, 60, 0, 0]),
					getCopperRegion: () => Promise.resolve(createPrimitive({
						getState_PourPrimitiveId: () => 'pour-gnd-inner1',
						getState_PourFills: () => [
							createPourFill('fill-left', ['R', 0, 0, 40, 60, 0, 0]),
							createPourFill('fill-right', ['R', 60, 0, 40, 60, 0, 0]),
						],
					})),
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitiveFill: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'fill-shield-1',
					getState_Net: () => 'SHIELD',
					getState_Layer: () => 1,
					getState_ComplexPolygon: () => createPolygon(['R', 60, 18, 20, 6, 0, 0]),
					getState_FillMode: () => 'SOLID',
					getState_LineWidth: () => 0.15,
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitiveRegion: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'region-keepout-1',
					getState_Layer: () => 1,
					getState_ComplexPolygon: () => createPolygon(['R', 68, 24, 6, 10, 0, 0]),
					getState_RuleType: () => ['NO_WIRES'],
					getState_RegionName: () => 'RF_KEEPOUT',
					getState_LineWidth: () => 0.1,
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitiveImage: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'image-1',
					getState_X: () => 20,
					getState_Y: () => 35,
					getState_ComplexPolygon: () => ['R', 20, 35, 8, 8, 0, 0],
					getState_Layer: () => 1,
					getState_Width: () => 8,
					getState_Height: () => 8,
					getState_Rotation: () => 0,
					getState_HorizonMirror: () => false,
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitiveObject: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'object-1',
					getState_Layer: () => 1,
					getState_TopLeftX: () => 28,
					getState_TopLeftY: () => 6,
					getState_Width: () => 8,
					getState_Height: () => 8,
					getState_Rotation: () => 0,
					getState_Mirror: () => false,
					getState_FileName: () => 'shield.step',
					getState_PrimitiveLock: () => false,
				}),
			]),
		},
		pcb_PrimitiveComponent: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'u1',
					getState_Layer: () => 1,
					getState_X: () => 10,
					getState_Y: () => 10,
					getState_Rotation: () => 0,
					getState_Designator: () => 'U1',
					getState_Name: () => 'MCU',
					getState_Pads: () => [{ primitiveId: 'u1-pad-1', net: 'CLK', padNumber: '1' }],
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'j1',
					getState_Layer: () => 1,
					getState_X: () => 90,
					getState_Y: () => 20,
					getState_Rotation: () => 0,
					getState_Designator: () => 'J1',
					getState_Name: () => 'HEADER',
					getState_Pads: () => [{ primitiveId: 'j1-pad-1', net: 'CLK', padNumber: '1' }],
					getState_PrimitiveLock: () => false,
				}),
			]),
			getAllPinsByPrimitiveId: vi.fn().mockImplementation(async (primitiveId: string) => {
				if (primitiveId === 'u1') {
					return [
						createPrimitive({
							getState_PrimitiveId: () => 'u1-pad-1',
							getState_Net: () => 'CLK',
							getState_Layer: () => 1,
							getState_PadNumber: () => '1',
							getState_X: () => 10,
							getState_Y: () => 10,
							getState_Rotation: () => 0,
							getState_Hole: () => null,
							getState_Pad: () => ['RECTANGLE', 1, 1],
							getState_PrimitiveLock: () => false,
						}),
					];
				}
				if (primitiveId === 'j1') {
					return [
						createPrimitive({
							getState_PrimitiveId: () => 'j1-pad-1',
							getState_Net: () => 'CLK',
							getState_Layer: () => 1,
							getState_PadNumber: () => '1',
							getState_X: () => 90,
							getState_Y: () => 20,
							getState_Rotation: () => 0,
							getState_Hole: () => null,
							getState_Pad: () => ['RECTANGLE', 1, 1],
							getState_PrimitiveLock: () => false,
						}),
					];
				}
				return [];
			}),
		},
	};
}

describe('pcbGeometryEnginePlugin', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installPcbEdaMock();
	});

	it('returns a normalized PCB snapshot with board outline split from trace geometry', async () => {
		const result = await pcbGeometryEnginePlugin.execute('snapshot', {}) as {
			ok: boolean;
			snapshot: {
				lines: Array<{ primitiveId: string }>;
				pours: Array<{ filledRegions: unknown[] }>;
				fills: unknown[];
				regions: unknown[];
				images: unknown[];
				objects: unknown[];
				boardOutlineSegments: Array<{ primitiveId: string }>;
				summary: { objectCounts: { lines: number; boardOutlineSegments: number; pads: number; fills: number; regions: number; images: number; objects: number } };
			};
		};

		expect(result.ok).toBe(true);
		expect(result.snapshot.lines.map(item => item.primitiveId)).toEqual(['track-1a', 'track-1b', 'track-1c', 'stub-1']);
		expect(result.snapshot.boardOutlineSegments).toHaveLength(4);
		expect(result.snapshot.summary.objectCounts).toMatchObject({
			lines: 4,
			boardOutlineSegments: 4,
			pads: 2,
			fills: 1,
			regions: 1,
			images: 1,
			objects: 1,
		});
		expect(result.snapshot.pours[0].filledRegions).toHaveLength(2);
		expect(result.snapshot.fills).toHaveLength(1);
		expect(result.snapshot.regions).toHaveLength(1);
		expect(result.snapshot.images).toHaveLength(1);
		expect(result.snapshot.objects).toHaveLength(1);
	});

	it('derives refined first-batch geometry features for route topology, split crossings, return-via distance, plane connectivity, loop area, and spatial relations', async () => {
		const result = await pcbGeometryEnginePlugin.execute('analyze', {
			tracePrimitiveIds: ['track-1a', 'track-1b', 'track-1c', 'stub-1'],
			analysisModes: ['net_stats', 'reference_grounding', 'return_via_clearance', 'plane_connectivity', 'loop_area_proxy', 'spatial_relations'],
			includeSnapshot: true,
		}) as {
			ok: boolean;
			summary: { traceCountAnalyzed: number; viaCountAnalyzed?: number; objectCountAnalyzed?: number };
			features: Array<{ featureType: string; subjectId: string; values: Record<string, unknown> }>;
			relations: Array<{ relationType: string; sourceId?: string }>;
			snapshot?: unknown;
		};

		expect(result.ok).toBe(true);
		expect(result.summary.traceCountAnalyzed).toBe(4);
		expect(result.summary.viaCountAnalyzed).toBe(1);
		expect(result.summary.objectCountAnalyzed).toBeGreaterThan(0);
		expect(result.snapshot).toBeDefined();
		expect(result.relations.some(item => item.relationType === 'trace_references_adjacent_copper_layer')).toBe(true);

		const netStats = result.features.find(item => item.featureType === 'net_path_stats');
		expect(netStats?.values.totalTrackLength).toBeCloseTo(100);
		expect(netStats?.values.viaCount).toBe(1);
		expect(netStats?.values.layerTransitionCount).toBe(1);
		expect(netStats?.values.connectedComponentCount).toBe(1);
		expect(netStats?.values.branchLengthEstimate).toBeCloseTo(10);
		expect(netStats?.values.stubLengthEstimate).toBeCloseTo(10);
		expect(netStats?.values.whetherStubLikelyExists).toBe(true);
		expect(netStats?.values.padEndpointCount).toBe(2);

		const groundingFeatures = result.features.filter(item => item.featureType === 'trace_reference_ground_coverage');
		const splitCrossingCounts = groundingFeatures
			.map(item => Number(item.values.planeSplitCrossingCount ?? 0))
			.sort((a, b) => b - a);
		expect(Number(groundingFeatures[0]?.values.coverageRatio ?? 0)).toBeLessThan(1);
		expect(groundingFeatures.some(item => item.values.hasAdjacentReferenceLayer === true)).toBe(true);
		expect(Array.isArray(groundingFeatures[0]?.values.referenceIslandIdsSeen)).toBe(true);
		expect(splitCrossingCounts[0]).toBe(1);

		const returnVia = result.features.find(item => item.featureType === 'signal_via_reference_via_clearance');
		expect(returnVia?.values.minReferenceViaDistance).toBeCloseTo(4);

		const connectivity = result.features.find(item => item.featureType === 'plane_connectivity_summary');
		expect(connectivity?.values.connectedIslandCount).toBe(2);
		expect(connectivity?.values.approximateFilledArea).toBe(4800);
		expect(connectivity?.values.isFragmented).toBe(true);

		const loopArea = result.features.find(item => item.featureType === 'net_loop_area_proxy');
		expect(Number(loopArea?.values.projectedLoopAreaProxy ?? 0)).toBeGreaterThan(0);
		expect(loopArea?.values.padEndpointCount).toBe(2);

		const nearestSpatial = result.features.find(item => item.featureType === 'trace_nearest_spatial_object_clearance' && item.subjectId === 'track-1c');
		expect(nearestSpatial?.values.objectKind).toBe('fill');
		expect(nearestSpatial?.values.minDistance).toBe(0);

		expect(result.relations.some(item => item.relationType === 'trace_overlaps_object_projection' && item.sourceId === 'track-1c')).toBe(true);
		expect(result.relations.some(item => item.relationType === 'trace_intersects_rule_region_projection' && item.sourceId === 'stub-1')).toBe(true);
	});

	it('reports missing reference support and via-only summaries without collapsing to zero analyzed objects', async () => {
		const pcbEda = (globalThis as typeof globalThis & {
			eda: {
				pcb_PrimitivePour: { getAll: ReturnType<typeof vi.fn> };
			};
		}).eda;
		pcbEda.pcb_PrimitivePour.getAll.mockResolvedValueOnce([]);

		const noReference = await pcbGeometryEnginePlugin.execute('analyze', {
			tracePrimitiveIds: ['track-1a'],
			analysisModes: ['reference_grounding'],
		}) as {
			features: Array<{ featureType: string; subjectId: string; values: Record<string, unknown> }>;
		};
		const noReferenceFeature = noReference.features.find(item => item.featureType === 'trace_reference_ground_coverage' && item.subjectId === 'track-1a');
		expect(noReferenceFeature?.values.hasAdjacentReferenceLayer).toBe(false);
		expect(noReferenceFeature?.values.planeSplitCrossingCount).toBe(0);

		const viaOnly = await pcbGeometryEnginePlugin.execute('analyze', {
			nets: ['CLK'],
			analysisModes: ['return_via_clearance'],
		}) as {
			summary: { traceCountAnalyzed: number; viaCountAnalyzed?: number; objectCountAnalyzed?: number };
			features: Array<{ featureType: string }>;
		};
		expect(viaOnly.summary.traceCountAnalyzed).toBe(0);
		expect(viaOnly.summary.viaCountAnalyzed).toBe(1);
		expect(viaOnly.summary.objectCountAnalyzed).toBe(0);
		expect(viaOnly.features.some(item => item.featureType === 'signal_via_reference_via_clearance')).toBe(true);
	});

	it('limits trace-based analysis modes to the requested tracePrimitiveIds subset', async () => {
		const result = await pcbGeometryEnginePlugin.execute('analyze', {
			tracePrimitiveIds: ['track-1a', 'track-1b'],
			analysisModes: ['net_stats', 'loop_area_proxy'],
		}) as {
			summary: { traceCountAnalyzed: number };
			features: Array<{ featureType: string; values: Record<string, unknown>; evidence: Record<string, unknown> }>;
		};

		const netStats = result.features.find(item => item.featureType === 'net_path_stats');
		const loopArea = result.features.find(item => item.featureType === 'net_loop_area_proxy');

		expect(result.summary.traceCountAnalyzed).toBe(2);
		expect(netStats?.values.totalTrackLength).toBeCloseTo(50);
		expect(netStats?.values.branchLengthEstimate).toBeCloseTo(0);
		expect(netStats?.evidence.tracePrimitiveIds).toEqual(['track-1a', 'track-1b']);
		expect(loopArea?.evidence.tracePrimitiveIds).toEqual(['track-1a', 'track-1b']);
	});

	it('skips board outline reads and warnings when board outline is excluded from the snapshot', async () => {
		const pcbEda = (globalThis as typeof globalThis & {
			eda: {
				pcb_PrimitiveLine: { getAll: ReturnType<typeof vi.fn> };
				pcb_PrimitiveArc: { getAll: ReturnType<typeof vi.fn> };
			};
		}).eda;

		const result = await pcbGeometryEnginePlugin.execute('snapshot', {
			include: {
				lines: false,
				arcs: false,
				boardOutline: false,
			},
		}) as {
			warnings: string[];
			snapshot: {
				lines: unknown[];
				arcs: unknown[];
				boardOutlineSegments: unknown[];
			};
		};

		expect(result.warnings).toEqual([]);
		expect(result.snapshot.lines).toEqual([]);
		expect(result.snapshot.arcs).toEqual([]);
		expect(result.snapshot.boardOutlineSegments).toEqual([]);
		expect(pcbEda.pcb_PrimitiveLine.getAll).not.toHaveBeenCalled();
		expect(pcbEda.pcb_PrimitiveArc.getAll).not.toHaveBeenCalled();
	});
});
