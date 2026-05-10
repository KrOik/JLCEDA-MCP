import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSchematicLocateTask } from './schematic-locator-handler';

function createStateObject(state: Record<string, unknown>): Record<string, () => unknown> {
	return Object.fromEntries(
		Object.entries(state).map(([key, value]) => [`getState_${key}`, () => value]),
	) as Record<string, () => unknown>;
}

function installLocatorMock(): void {
	(globalThis as typeof globalThis & { eda?: unknown }).eda = {
		dmt_Schematic: {
			getCurrentSchematicInfo: vi.fn().mockResolvedValue({ name: 'ESP32 Demo', uuid: 'sch-1' }),
			getCurrentSchematicPageInfo: vi.fn().mockResolvedValue({ name: 'MCU', uuid: 'page-1', parentSchematicUuid: 'sch-1' }),
			getCurrentSchematicAllSchematicPagesInfo: vi.fn().mockResolvedValue([
				{ name: 'MCU', uuid: 'page-1', parentSchematicUuid: 'sch-1' },
				{ name: 'AFE', uuid: 'page-2', parentSchematicUuid: 'sch-1' },
			]),
			getAllSchematicPagesInfo: vi.fn().mockResolvedValue([
				{ name: 'MCU', uuid: 'page-1', parentSchematicUuid: 'sch-1' },
				{ name: 'AFE', uuid: 'page-2', parentSchematicUuid: 'sch-1' },
				{ name: 'POWER', uuid: 'page-3', parentSchematicUuid: 'sch-2' },
			]),
		},
		sch_PrimitiveComponent: {
			getAll: vi.fn(async (_componentType?: unknown, allSchematicPages?: boolean) => {
				if (allSchematicPages === false) {
					return [
						createStateObject({
							PrimitiveId: 'esp32-1',
							Designator: 'U1',
							Name: 'ESP32-PICO-V3-02',
							SubPartName: '',
							Footprint: 'QFN-48',
							Manufacturer: 'Espressif',
							ManufacturerId: 'ESP32-PICO-V3-02',
							Supplier: 'LCSC',
							SupplierId: 'C2913206',
							UniqueId: 'uid-u1',
							Net: '',
							SchematicPageUuid: 'page-1',
						}),
					];
				}

				return [
					createStateObject({
						PrimitiveId: 'esp32-1',
						Designator: 'U1',
						Name: 'ESP32-PICO-V3-02',
						SubPartName: '',
						Footprint: 'QFN-48',
						Manufacturer: 'Espressif',
						ManufacturerId: 'ESP32-PICO-V3-02',
						Supplier: 'LCSC',
						SupplierId: 'C2913206',
						UniqueId: 'uid-u1',
						Net: '',
						SchematicPageUuid: 'page-1',
					}),
					createStateObject({
						PrimitiveId: 'afe-1',
						Designator: 'U2',
						Name: 'LMP91000',
						SubPartName: '',
						Footprint: 'WSON-14',
						Manufacturer: 'TI',
						ManufacturerId: 'LMP91000',
						Supplier: 'LCSC',
						SupplierId: 'C84366',
						UniqueId: 'uid-u2',
						Net: '',
						SchematicPageUuid: 'page-2',
					}),
					createStateObject({
						PrimitiveId: 'r1',
						Designator: 'R1',
						Name: 'RES',
						SubPartName: '',
						Net: '',
						SchematicPageUuid: 'page-1',
					}),
				];
			}),
			getAllPinsByPrimitiveId: vi.fn(async (primitiveId: string) => {
				if (primitiveId === 'esp32-1') {
					return [
						createStateObject({ PinNumber: '17', PinName: 'GPIO23', PinType: 'io', X: 10, Y: 10, NoConnected: false }),
						createStateObject({ PinNumber: '18', PinName: 'GPIO19', PinType: 'io', X: 20, Y: 10, NoConnected: false }),
					];
				}
				if (primitiveId === 'afe-1') {
					return [
						createStateObject({ PinNumber: '1', PinName: 'VOUT', PinType: 'io', X: 60, Y: 10, NoConnected: false }),
					];
				}
				return [createStateObject({ PinNumber: '1', PinName: 'A', PinType: 'passive', X: 90, Y: 90, NoConnected: true })];
			}),
		},
		sch_PrimitiveWire: {
			getAll: vi.fn().mockResolvedValue([
				createStateObject({ Line: [10, 10, 40, 10], Net: 'SPI_MOSI' }),
				createStateObject({ Line: [20, 10, 50, 10], Net: 'SPI_MISO' }),
			]),
		},
		sch_Drc: {
			check: vi.fn().mockResolvedValue(true),
		},
		sch_ManufactureData: {
			getNetlistFile: vi.fn().mockResolvedValue({
				text: vi.fn().mockResolvedValue(JSON.stringify({
					components: {
						'net-u1': {
							props: {
								Designator: 'U1',
								Name: '={Manufacturer Part}',
								'Manufacturer Part': 'CH340E',
								Manufacturer: 'WCH',
								'Supplier Part': 'C99652',
								Supplier: 'LCSC',
								'Unique ID': 'uid-u1',
								FootprintName: 'MSOP-10',
							},
							pinInfoMap: {
								'1': { name: 'UD+', number: '1', net: 'USB_D+', props: {} },
							},
						},
						'power-u1': {
							props: {
								Designator: 'U1_PWR',
								Name: 'REG',
								'Manufacturer Part': 'TPS7A2033PDBVR',
								Manufacturer: 'TI',
								'Supplier Part': 'C2862740',
								Supplier: 'LCSC',
								'Unique ID': 'power-u1',
								FootprintName: 'SOT-23-5',
							},
							pinInfoMap: {
								'1': { name: 'OUT', number: '1', net: '3.3V', props: {} },
							},
						},
					},
				})),
			}),
		},
	};
}

describe('handleSchematicLocateTask', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installLocatorMock();
	});

	it('locates a component by exact model and returns bounded pin-net details', async () => {
		const result = await handleSchematicLocateTask({ query: 'ESP32-PICO-V3-02', limit: 1 }) as Record<string, unknown>;
		const matches = result.matches as Array<{ component?: { designator: string; pins: Array<{ pinNumber: string; pinName: string; networkName: string }> } }>;

		expect(result).toMatchObject({
			ok: true,
			query: 'ESP32-PICO-V3-02',
			normalizedQuery: 'esp32picov302',
			scope: 'current-schematic',
			limit: 1,
			totalCandidates: 1,
			summary: {
				componentCount: 3,
				networkCount: 2,
				exactMatchCount: 1,
			},
		});
		expect(matches).toHaveLength(1);
		expect(matches[0]?.component?.designator).toBe('U1');
		expect(matches[0]?.component?.pins).toEqual([
			{ pinNumber: '17', pinName: 'GPIO23', networkName: 'SPI_MOSI', hasNoConnectMark: false },
			{ pinNumber: '18', pinName: 'GPIO19', networkName: 'SPI_MISO', hasNoConnectMark: false },
		]);
	});

	it('locates a network by name without returning the full schematic snapshot', async () => {
		const result = await handleSchematicLocateTask({ query: 'SPI_MOSI', scope: 'current-schematic' }) as Record<string, unknown>;
		const matches = result.matches as Array<{ kind: string; networkName?: string; connectedPins?: string[] }>;

		expect(result).toMatchObject({
			ok: true,
			scope: 'current-schematic',
			totalCandidates: 1,
		});
		expect(matches).toEqual([
			{
				kind: 'net',
				score: 96,
				matchText: 'SPI_MOSI',
				networkName: 'SPI_MOSI',
				connectedPins: ['U1.17'],
			},
		]);
		expect(JSON.stringify(result)).not.toContain('schematicCircuitSnapshot');
	});

	it('applies narrower component scope for current-page than current-schematic', async () => {
		const currentPage = await handleSchematicLocateTask({ query: 'LMP91000', scope: 'current-page' }) as Record<string, unknown>;
		const currentSchematic = await handleSchematicLocateTask({ query: 'LMP91000', scope: 'current-schematic' }) as Record<string, unknown>;

		expect(currentPage.totalCandidates).toBe(0);
		expect(currentSchematic.totalCandidates).toBe(1);
		expect((currentSchematic.matches as Array<{ component?: { designator: string } }>)[0]?.component?.designator).toBe('U2');
	});

	it('returns page context populated from live-style plain objects', async () => {
		const result = await handleSchematicLocateTask({ query: 'ESP32', scope: 'current-page' }) as Record<string, unknown>;

		expect(result.pageContext).toEqual({
			pageName: 'MCU',
			pageUuid: 'page-1',
			schematicName: 'ESP32 Demo',
			schematicUuid: 'sch-1',
			allPageNames: ['MCU', 'AFE'],
		});
	});

	it('widens all-schematics lookups beyond the current schematic using the project netlist', async () => {
		const currentSchematic = await handleSchematicLocateTask({ query: 'TPS7A2033PDBVR', scope: 'current-schematic' }) as Record<string, unknown>;
		const allSchematics = await handleSchematicLocateTask({ query: 'TPS7A2033PDBVR', scope: 'all-schematics' }) as Record<string, unknown>;

		expect(currentSchematic.totalCandidates).toBe(0);
		expect(allSchematics.totalCandidates).toBe(1);
		expect((allSchematics.matches as Array<{ component?: { designator: string } }>)[0]?.component?.designator).toBe('U1_PWR');
	});

	it('keeps current-schematic exact designator matches at the top when all-schematics is widened by netlist data', async () => {
		const currentSchematic = await handleSchematicLocateTask({ query: 'U1', scope: 'current-schematic', limit: 5 }) as Record<string, unknown>;
		const allSchematics = await handleSchematicLocateTask({ query: 'U1', scope: 'all-schematics', limit: 5 }) as Record<string, unknown>;

		expect((currentSchematic.matches as Array<{ component?: { designator: string } }>)[0]?.component?.designator).toBe('U1');
		expect((allSchematics.matches as Array<{ component?: { designator: string } }>)[0]?.component?.designator).toBe('U1');
		expect(allSchematics.totalCandidates).toBeGreaterThan(currentSchematic.totalCandidates as number);
	});

	it('deduplicates current-schematic and netlist copies of the same component in all-schematics', async () => {
		const allSchematics = await handleSchematicLocateTask({ query: 'U1', scope: 'all-schematics', limit: 10 }) as Record<string, unknown>;
		const matchTexts = (allSchematics.matches as Array<{ matchText: string }>).map(item => item.matchText);
		const exactU1Count = matchTexts.filter(text => text === 'U1').length;

		expect(exactU1Count).toBe(1);
	});

	it('rejects empty query and invalid scope before scanning EDA state', async () => {
		await expect(handleSchematicLocateTask({ query: '   ' })).rejects.toThrow('schematic_locate 缺少 query 参数。');
		await expect(handleSchematicLocateTask({ query: 'U1', scope: 'bad' })).rejects.toThrow('scope 仅支持 current-page/current-schematic/all-schematics。');
	});
});
