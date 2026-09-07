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

		await expect(handleSchematicReviewTask({})).resolves.toMatchObject({
			ok: true,
			drcCheckPassed: false,
			drcStrict: true,
			netlistText: 'R1 1 2 10k',
		});
	});
	it('uses strict boolean DRC and flags the empty-ID unconnected netlist seen in the STM32 session', async () => {
		const mock = installSchematicReviewMock();
		mock.sch_ManufactureData.getNetlistFile.mockResolvedValue({ text: async () => JSON.stringify({
			components: { '': { props: { 'Unique ID': '', Designator: 'U?' }, pinInfoMap: { '1': { net: '' } } } },
		}) });
		const result = await handleSchematicReviewTask({});
		expect(mock.sch_Drc.check).toHaveBeenCalledWith(true, false, false);
		expect(result).toMatchObject({ drcCheckPassed: true, warnings: [expect.stringContaining('空唯一 ID'), expect.stringContaining('没有可识别的已连接引脚')] });
	});
	it('does not treat an unavailable DRC result as a checked design', async () => {
		const mock = installSchematicReviewMock();
		mock.sch_Drc.check.mockResolvedValue(undefined);
		expect(await handleSchematicReviewTask({})).toMatchObject({ drcCheckPassed: false, warnings: expect.arrayContaining([expect.stringContaining('DRC 未返回')]) });
	});
	it('accepts a numbered connected netlist without completeness claims', async () => {
		const mock = installSchematicReviewMock();
		mock.sch_ManufactureData.getNetlistFile.mockResolvedValue({ text: async () => JSON.stringify({
			components: { u1: { props: { 'Unique ID': 'u1', Designator: 'U1' }, pinInfoMap: { '1': { net: 'GND' } } } },
		}) });
		expect(await handleSchematicReviewTask({})).toMatchObject({ warnings: [], drcStrict: true });
	});
});
