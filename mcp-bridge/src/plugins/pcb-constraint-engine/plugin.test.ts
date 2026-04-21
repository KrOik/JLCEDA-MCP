import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pcbConstraintEnginePlugin } from './plugin.ts';

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
				uuid: 'pcb-constraint-1',
				name: 'Constraint Board',
				parentProjectUuid: 'project-constraint-1',
				parentBoardName: 'Carrier Board',
			}),
		},
		pcb_Drc: {
			getCurrentRuleConfigurationName: vi.fn().mockResolvedValue('HS_BASE'),
			getCurrentRuleConfiguration: vi.fn().mockResolvedValue({
				diffPairGap: 0.15,
				diffPairImpedance: 90,
			}),
			getNetRules: vi.fn().mockResolvedValue([
				{ net: 'USB_DP', minWidth: 0.12 },
				{ net: 'USB_DN', minWidth: 0.12 },
			]),
			getNetByNetRules: vi.fn().mockResolvedValue({
				USB_DP: { USB_DN: { minClearance: 0.1 } },
			}),
			getRegionRules: vi.fn().mockResolvedValue([
				{ regionName: 'HS_KEEP_OUT', ruleType: 'NO_WIRES' },
			]),
			getAllDifferentialPairs: vi.fn().mockResolvedValue([
				{ name: 'USB', positiveNet: 'USB_DP', negativeNet: 'USB_DN' },
			]),
			getAllEqualLengthNetGroups: vi.fn().mockResolvedValue([
				{ name: 'USB_EQ', nets: ['USB_DP', 'USB_DN'], color: { r: 1, g: 2, b: 3, alpha: 1 } },
			]),
			getAllNetClasses: vi.fn().mockResolvedValue([
				{ name: 'HS', nets: ['USB_DP', 'USB_DN', 'REFCLK'], color: { r: 10, g: 20, b: 30, alpha: 1 } },
			]),
			getAllPadPairGroups: vi.fn().mockResolvedValue([
				{ name: 'USB_CONN', padPairs: [['J1:1', 'U1:33']] },
			]),
			getPadPairGroupMinWireLength: vi.fn().mockImplementation(async (name: string) => {
				if (name === 'USB_CONN') {
					return [{ padPair: ['J1:1', 'U1:33'], minWireLength: 42.5 }];
				}
				return [];
			}),
		},
		pcb_PrimitiveVia: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'via-1',
					getState_Net: () => 'USB_DP',
					getState_X: () => 10,
					getState_Y: () => 20,
					getState_Diameter: () => 0.45,
					getState_HoleDiameter: () => 0.2,
					getState_ViaType: () => 'BLIND_BURIED',
					getState_DesignRuleBlindViaName: () => 'L1-L2_MICROVIA',
					getState_SolderMaskExpansion: () => ({ top: 0.05, bottom: 0.05 }),
					getState_PrimitiveLock: () => false,
					getAdjacentPrimitives: () => Promise.resolve([
						createPrimitive({
							getState_PrimitiveId: () => 'line-1',
						}),
					]),
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'via-2',
					getState_Net: () => 'REFCLK',
					getState_X: () => 30,
					getState_Y: () => 40,
					getState_Diameter: () => 0.5,
					getState_HoleDiameter: () => 0.25,
					getState_ViaType: () => 'NORMAL',
					getState_DesignRuleBlindViaName: () => null,
					getState_SolderMaskExpansion: () => null,
					getState_PrimitiveLock: () => true,
					getAdjacentPrimitives: () => Promise.resolve([]),
				}),
			]),
		},
		pcb_PrimitivePad: {
			getAll: vi.fn().mockResolvedValue([
				createPrimitive({
					getState_PrimitiveId: () => 'pad-1',
					getState_Net: () => 'USB_DP',
					getState_Layer: () => 1,
					getState_X: () => 15,
					getState_Y: () => 25,
					getState_PadNumber: () => '1',
					getState_PadType: () => 'THROUGH_HOLE',
					getState_Rotation: () => 90,
					getState_Hole: () => ['ROUND', 0.3, 0.3],
					getState_HoleOffsetX: () => 0.01,
					getState_HoleOffsetY: () => 0.02,
					getState_HoleRotation: () => 5,
					getState_Metallization: () => true,
					getState_Pad: () => ['RECTANGLE', 1, 2],
					getState_SpecialPad: () => [[1, 2, ['ROUND', 1, 1]]],
					getState_HeatWelding: () => ({ spokeCount: 4 }),
					getState_SolderMaskAndPasteMaskExpansion: () => ({ top: 0.05, bottom: 0.05 }),
					getState_PrimitiveLock: () => false,
				}),
				createPrimitive({
					getState_PrimitiveId: () => 'pad-2',
					getState_Net: () => 'REFCLK',
					getState_Layer: () => 2,
					getState_X: () => 55,
					getState_Y: () => 65,
					getState_PadNumber: () => 'A1',
					getState_PadType: () => 'SMD',
					getState_Rotation: () => 0,
					getState_Hole: () => null,
					getState_HoleOffsetX: () => 0,
					getState_HoleOffsetY: () => 0,
					getState_HoleRotation: () => 0,
					getState_Metallization: () => false,
					getState_Pad: () => ['ROUND', 1, 1],
					getState_SpecialPad: () => undefined,
					getState_HeatWelding: () => null,
					getState_SolderMaskAndPasteMaskExpansion: () => null,
					getState_PrimitiveLock: () => true,
				}),
			]),
		},
	};
}

describe('pcbConstraintEnginePlugin', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installPcbEdaMock();
	});

	it('returns a normalized second-layer constraint snapshot', async () => {
		const result = await pcbConstraintEnginePlugin.execute('snapshot', {}) as {
			ok: boolean;
			warnings: string[];
			snapshot: {
				rules: {
					configurationName: string | null;
					netRules: unknown[];
				};
				differentialPairs: Array<{ name: string }>;
				equalLengthNetGroups: Array<{ name: string }>;
				netClasses: Array<{ name: string }>;
				padPairGroups: Array<{ name: string; minWireLengths: Array<{ minWireLength: number }> }>;
				vias: Array<{ primitiveId: string; blindViaRuleName: string | null; adjacentPrimitiveIds: string[] }>;
				pads: Array<{ primitiveId: string; specialPadShape: unknown; heatWelding: unknown }>;
				summary: {
					differentialPairCount: number;
					equalLengthNetGroupCount: number;
					netClassCount: number;
					padPairGroupCount: number;
					viaCount: number;
					padCount: number;
				};
			};
		};

		expect(result.ok).toBe(true);
		expect(result.warnings).toEqual([]);
		expect(result.snapshot.rules.configurationName).toBe('HS_BASE');
		expect(result.snapshot.rules.netRules).toHaveLength(2);
		expect(result.snapshot.differentialPairs.map(item => item.name)).toEqual(['USB']);
		expect(result.snapshot.equalLengthNetGroups.map(item => item.name)).toEqual(['USB_EQ']);
		expect(result.snapshot.netClasses.map(item => item.name)).toEqual(['HS']);
		expect(result.snapshot.padPairGroups[0]?.minWireLengths[0]?.minWireLength).toBe(42.5);
		expect(result.snapshot.vias[0]).toMatchObject({
			primitiveId: 'via-1',
			blindViaRuleName: 'L1-L2_MICROVIA',
			adjacentPrimitiveIds: ['line-1'],
		});
		expect(result.snapshot.pads[0]).toMatchObject({
			primitiveId: 'pad-1',
		});
		expect(result.snapshot.pads[0]?.specialPadShape).toBeDefined();
		expect(result.snapshot.pads[0]?.heatWelding).toBeDefined();
		expect(result.snapshot.summary).toMatchObject({
			differentialPairCount: 1,
			equalLengthNetGroupCount: 1,
			netClassCount: 1,
			padPairGroupCount: 1,
			viaCount: 2,
			padCount: 2,
		});
	});

	it('filters net-bound sections by nets and primitive ids', async () => {
		const result = await pcbConstraintEnginePlugin.execute('snapshot', {
			nets: ['usb_dp'],
			viaPrimitiveIds: ['via-1'],
			padPrimitiveIds: ['pad-1'],
		}) as {
			warnings: string[];
			snapshot: {
				differentialPairs: Array<{ name: string }>;
				equalLengthNetGroups: Array<{ name: string }>;
				netClasses: Array<{ name: string }>;
				padPairGroups: Array<{ name: string }>;
				vias: Array<{ primitiveId: string }>;
				pads: Array<{ primitiveId: string }>;
			};
		};

		expect(result.snapshot.differentialPairs.map(item => item.name)).toEqual(['USB']);
		expect(result.snapshot.equalLengthNetGroups.map(item => item.name)).toEqual(['USB_EQ']);
		expect(result.snapshot.netClasses.map(item => item.name)).toEqual(['HS']);
		expect(result.snapshot.vias.map(item => item.primitiveId)).toEqual(['via-1']);
		expect(result.snapshot.pads.map(item => item.primitiveId)).toEqual(['pad-1']);
		expect(result.snapshot.padPairGroups.map(item => item.name)).toEqual(['USB_CONN']);
		expect(result.warnings).toContain('padPairGroups 当前不支持按 nets 精确过滤，返回全量焊盘对组。');
	});

	it('degrades to warnings when via or pad collection fails', async () => {
		const pcbEda = (globalThis as typeof globalThis & {
			eda: {
				pcb_PrimitiveVia: { getAll: ReturnType<typeof vi.fn> };
				pcb_PrimitivePad: { getAll: ReturnType<typeof vi.fn> };
			};
		}).eda;
		pcbEda.pcb_PrimitiveVia.getAll.mockRejectedValueOnce(new Error('via api offline'));
		pcbEda.pcb_PrimitivePad.getAll.mockRejectedValueOnce(new Error('pad api offline'));

		const result = await pcbConstraintEnginePlugin.execute('snapshot', {}) as {
			warnings: string[];
			snapshot: {
				vias: unknown[];
				pads: unknown[];
			};
		};

		expect(result.snapshot.vias).toEqual([]);
		expect(result.snapshot.pads).toEqual([]);
		expect(result.warnings).toContain('过孔约束快照 读取失败：via api offline');
		expect(result.warnings).toContain('焊盘约束快照 读取失败：pad api offline');
	});

	it('surfaces warnings when via adjacency lookup fails', async () => {
		const pcbEda = (globalThis as typeof globalThis & {
			eda: {
				pcb_PrimitiveVia: { getAll: ReturnType<typeof vi.fn> };
			};
		}).eda;
		pcbEda.pcb_PrimitiveVia.getAll.mockResolvedValueOnce([
			createPrimitive({
				getState_PrimitiveId: () => 'via-adj-fail',
				getState_Net: () => 'USB_DP',
				getState_X: () => 1,
				getState_Y: () => 2,
				getState_Diameter: () => 0.4,
				getState_HoleDiameter: () => 0.2,
				getState_ViaType: () => 'NORMAL',
				getState_DesignRuleBlindViaName: () => null,
				getState_SolderMaskExpansion: () => null,
				getState_PrimitiveLock: () => false,
				getAdjacentPrimitives: () => Promise.reject(new Error('adjacency read failed')),
			}),
		]);

		const result = await pcbConstraintEnginePlugin.execute('snapshot', {
			include: { pads: false },
		}) as {
			warnings: string[];
			snapshot: {
				vias: Array<{ primitiveId: string; adjacentPrimitiveIds: string[] }>;
			};
		};

		expect(result.snapshot.vias[0]).toMatchObject({
			primitiveId: 'via-adj-fail',
			adjacentPrimitiveIds: [],
		});
		expect(result.warnings).toContain('via 邻接图元 读取失败：adjacency read failed');
	});
});
