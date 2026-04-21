import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSchematicReadTask } from './schematic-read-handler';

function createStateObject(state: Record<string, unknown>): Record<string, () => unknown> {
	return Object.fromEntries(
		Object.entries(state).map(([key, value]) => [`getState_${key}`, () => value]),
	) as Record<string, () => unknown>;
}

interface SchematicReadMock {
	sch_PrimitiveComponent: {
		getAll: ReturnType<typeof vi.fn>;
		getAllPinsByPrimitiveId: ReturnType<typeof vi.fn>;
	};
	sch_PrimitiveWire: {
		getAll: ReturnType<typeof vi.fn>;
	};
	sch_Drc: {
		check: ReturnType<typeof vi.fn>;
	};
}

function installSchematicReadMock(overrides?: Partial<SchematicReadMock>): SchematicReadMock {
	const edaMock: SchematicReadMock = {
		sch_PrimitiveComponent: {
			getAll: vi.fn().mockResolvedValue([]),
			getAllPinsByPrimitiveId: vi.fn().mockResolvedValue([]),
		},
		sch_PrimitiveWire: {
			getAll: vi.fn().mockResolvedValue([]),
		},
		sch_Drc: {
			check: vi.fn().mockResolvedValue(true),
		},
	};

	const merged = {
		...edaMock,
		...overrides,
	};
	(globalThis as typeof globalThis & { eda?: SchematicReadMock }).eda = merged;
	return merged;
}

describe('handleSchematicReadTask', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installSchematicReadMock();
	});

	it('returns an explicit error when SCH_PrimitiveComponent.getAll does not return an array', async () => {
		installSchematicReadMock({
			sch_PrimitiveComponent: {
				getAll: vi.fn().mockResolvedValue(undefined),
				getAllPinsByPrimitiveId: vi.fn().mockResolvedValue([]),
			},
		});

		await expect(handleSchematicReadTask({})).resolves.toEqual({
			ok: false,
			error: '器件列表获取失败，sch_PrimitiveComponent.getAll 未返回数组。',
		});
	});

	it('returns an explicit error when getAllPinsByPrimitiveId returns a malformed value', async () => {
		installSchematicReadMock({
			sch_PrimitiveComponent: {
				getAll: vi.fn().mockResolvedValue([
					createStateObject({
						PrimitiveId: 'comp-1',
						Designator: 'R1',
						Name: 'RES',
						SubPartName: '',
						Net: '',
					}),
				]),
				getAllPinsByPrimitiveId: vi.fn().mockResolvedValue({ invalid: true }),
			},
		});

		await expect(handleSchematicReadTask({})).resolves.toEqual({
			ok: false,
			error: '器件 R1 的引脚列表格式异常。',
		});
	});

	it('builds a semantic snapshot by propagating network names through wires and net flags', async () => {
		installSchematicReadMock({
			sch_PrimitiveComponent: {
				getAll: vi.fn().mockResolvedValue([
					createStateObject({
						PrimitiveId: 'netflag-1',
						Designator: '',
						Name: 'VCC',
						Net: 'VCC',
						X: 10,
						Y: 20,
					}),
					createStateObject({
						PrimitiveId: 'comp-1',
						Designator: 'R1',
						Name: 'RES',
						SubPartName: 'A',
						Net: '',
					}),
				]),
				getAllPinsByPrimitiveId: vi.fn().mockResolvedValue([
					createStateObject({
						PinNumber: '1',
						PinName: 'IN',
						PinType: 'passive',
						X: 30,
						Y: 40,
						NoConnected: false,
					}),
				]),
			},
			sch_PrimitiveWire: {
				getAll: vi.fn().mockResolvedValue([
					createStateObject({
						Line: [10, 20, 30, 40],
						Net: '',
					}),
				]),
			},
			sch_Drc: {
				check: vi.fn().mockResolvedValue(false),
			},
		});

		const result = await handleSchematicReadTask({}) as {
			ok: boolean;
			schematicCircuitSnapshot: string;
		};
		const snapshot = JSON.parse(result.schematicCircuitSnapshot) as {
			drcCheckPassed: boolean;
			componentCount: number;
			networkCount: number;
			components: Array<Record<string, unknown>>;
			networks: Array<{ networkName: string; connectedPinRefs: string[] }>;
		};

		expect(result.ok).toBe(true);
		expect(snapshot.drcCheckPassed).toBe(false);
		expect(snapshot.componentCount).toBe(2);
		expect(snapshot.networkCount).toBe(1);
		expect(snapshot.networks).toEqual([
			{
				networkName: 'VCC',
				connectedPinRefs: ['R1.1', 'VCC.1'],
			},
		]);
		expect(snapshot.components).toEqual([
			{
				componentInstanceId: 'netflag-1',
				componentDesignator: 'VCC',
				componentSymbolName: 'VCC',
				schematicSubPartName: '',
				pins: [
					{
						pinNumber: '1',
						pinSignalName: 'VCC',
						pinElectricalType: 'power',
						connectedNetworkName: 'VCC',
						hasNoConnectMark: false,
					},
				],
			},
			{
				componentInstanceId: 'comp-1',
				componentDesignator: 'R1',
				componentSymbolName: 'RES',
				schematicSubPartName: 'A',
				pins: [
					{
						pinNumber: '1',
						pinSignalName: 'IN',
						pinElectricalType: 'passive',
						connectedNetworkName: 'VCC',
						hasNoConnectMark: false,
					},
				],
			},
		]);
	});
});
