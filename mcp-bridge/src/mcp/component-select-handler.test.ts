import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleComponentSelectTask } from './component-select-handler';

interface EdaMock {
	lib_Device?: {
		search: ReturnType<typeof vi.fn>;
	};
}

function installEdaMock(searchImpl?: ReturnType<typeof vi.fn>): EdaMock {
	const search = searchImpl ?? vi.fn();
	const edaMock: EdaMock = {
		lib_Device: {
			search,
		},
	}

	;(globalThis as typeof globalThis & { eda?: EdaMock }).eda = edaMock;

	return edaMock;
}

describe('handleComponentSelectTask', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installEdaMock();
	});

	it('requires the payload to be an object', async () => {
		await expect(handleComponentSelectTask(null)).rejects.toThrow(TypeError);
		await expect(handleComponentSelectTask('keyword')).rejects.toThrow('component/select 任务参数必须为对象');
	});

	it('requires a keyword', async () => {
		await expect(handleComponentSelectTask({})).rejects.toThrow('component_select 缺少 keyword 参数');
	});

	it('rejects ambiguous resistor or capacitor values without explicit unit symbols', async () => {
		await expect(handleComponentSelectTask({ keyword: 'resistor 1k' })).rejects.toThrow('缺少单位');
		await expect(handleComponentSelectTask({ keyword: '电容 100n' })).rejects.toThrow('缺少单位');
	});

	it('validates limit boundaries before calling the search api', async () => {
		const search = vi.fn();
		installEdaMock(search);

		await expect(handleComponentSelectTask({ keyword: 'STM32', limit: 21 })).rejects.toThrow('整数参数超出范围');
		expect(search).not.toHaveBeenCalled();
	});

	it('returns a not-found result when the search api has no matches', async () => {
		const search = vi.fn().mockResolvedValue([]);
		installEdaMock(search);

		await expect(handleComponentSelectTask({ keyword: 'STM32' })).resolves.toEqual({
			ok: false,
			error: '未在立创商城中找到匹配“STM32”的器件，请调整关键词后重试。',
		});
		expect(search).toHaveBeenCalledWith('STM32', undefined, undefined, undefined, 20, 1);
	});

	it('returns a validation error when candidates miss required identifiers', async () => {
		const search = vi.fn().mockResolvedValue([
			{
				name: 'Invalid Candidate',
				libraryUuid: '',
				uuid: '',
			},
		]);
		installEdaMock(search);

		await expect(handleComponentSelectTask({ keyword: 'MCU' })).resolves.toEqual({
			ok: false,
			error: '搜索结果缺少必要的 uuid 或 libraryUuid 字段，无法继续选型。',
		});
	});

	it('wraps reference API failures with a stable business error message', async () => {
		const search = vi.fn().mockRejectedValue(new Error('network down'));
		installEdaMock(search);

		await expect(handleComponentSelectTask({ keyword: 'MCU' })).rejects.toThrow('器件搜索失败：network down');
	});

	it('returns a normalized selection payload for valid results', async () => {
		const search = vi.fn().mockResolvedValue([
			{
				uuid: 'device-1',
				libraryuuid: 'lib-1',
				name: 'STM32F103C8T6',
				symbolname: 'MCU_STM32F103',
				footprintname: 'LQFP-48',
				description: 'Blue pill MCU',
				manufacturer: 'ST',
				manufacturerid: 'ST-001',
				supplier: 'LCSC',
				supplierid: 'C12345',
				lcscinventory: '3210',
				lcscprice: '6.5',
			},
		]);
		installEdaMock(search);

		const result = await handleComponentSelectTask({
			keyword: 'STM32F103',
			limit: 5,
			page: 2,
		}) as {
			ok: boolean;
			selection: {
				protocol: string;
				title: string;
				description: string;
				pageSize: number;
				currentPage: number;
				candidates: Array<Record<string, unknown>>;
			};
		};

		expect(search).toHaveBeenCalledWith('STM32F103', undefined, undefined, undefined, 5, 2);
		expect(result.ok).toBe(true);
		expect(result.selection).toMatchObject({
			protocol: 'component-select/v1',
			title: '器件选型：STM32F103',
			description: '以下是系统库中“STM32F103”的搜索结果，请先确认具体型号后再继续放置。',
			pageSize: 5,
			currentPage: 2,
		});
		expect(result.selection.candidates).toEqual([
			{
				uuid: 'device-1',
				libraryUuid: 'lib-1',
				name: 'STM32F103C8T6',
				symbolName: 'MCU_STM32F103',
				footprintName: 'LQFP-48',
				description: 'Blue pill MCU',
				manufacturer: 'ST',
				manufacturerId: 'ST-001',
				supplier: 'LCSC',
				supplierId: 'C12345',
				lcscInventory: 3210,
				lcscPrice: 6.5,
			},
		]);
	});
});
