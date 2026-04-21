import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSchematicReviewTask } from './schematic-review-handler';

interface SchematicReviewMock {
	sch_Drc: { check: ReturnType<typeof vi.fn> };
	sch_ManufactureData: { getNetlistFile: ReturnType<typeof vi.fn> };
}

function installSchematicReviewMock(overrides?: Partial<SchematicReviewMock>): SchematicReviewMock {
	const edaMock: SchematicReviewMock = {
		sch_Drc: {
			check: vi.fn().mockResolvedValue(true),
		},
		sch_ManufactureData: {
			getNetlistFile: vi.fn().mockResolvedValue({
				text: vi.fn().mockResolvedValue('NETLIST CONTENT'),
			}),
		},
	};

	const merged = {
		...edaMock,
		...overrides,
	};
	(globalThis as typeof globalThis & { eda?: SchematicReviewMock }).eda = merged;
	return merged;
}

describe('handleSchematicReviewTask', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installSchematicReviewMock();
	});

	it('returns an explicit error when SCH_ManufactureData.getNetlistFile resolves to undefined', async () => {
		installSchematicReviewMock({
			sch_ManufactureData: {
				getNetlistFile: vi.fn().mockResolvedValue(undefined),
			},
		});

		await expect(handleSchematicReviewTask({})).resolves.toEqual({
			ok: false,
			error: '网表文件获取失败，sch_ManufactureData.getNetlistFile 返回空。',
		});
	});

	it('returns an explicit error when the netlist file object is malformed', async () => {
		installSchematicReviewMock({
			sch_ManufactureData: {
				getNetlistFile: vi.fn().mockResolvedValue({}),
			},
		});

		await expect(handleSchematicReviewTask({})).resolves.toEqual({
			ok: false,
			error: '网表文件对象格式异常，无法读取文本内容。',
		});
	});

	it('returns an explicit error when the netlist text is blank', async () => {
		installSchematicReviewMock({
			sch_ManufactureData: {
				getNetlistFile: vi.fn().mockResolvedValue({
					text: vi.fn().mockResolvedValue('   '),
				}),
			},
		});

		await expect(handleSchematicReviewTask({})).resolves.toEqual({
			ok: false,
			error: '网表文件内容为空，请确认原理图不为空。',
		});
	});

	it('returns netlist text together with the DRC result', async () => {
		installSchematicReviewMock({
			sch_Drc: {
				check: vi.fn().mockResolvedValue(false),
			},
			sch_ManufactureData: {
				getNetlistFile: vi.fn().mockResolvedValue({
					text: vi.fn().mockResolvedValue('R1 1 2 10k'),
				}),
			},
		});

		await expect(handleSchematicReviewTask({})).resolves.toEqual({
			ok: true,
			drcCheckPassed: false,
			netlistText: 'R1 1 2 10k',
		});
	});
});
