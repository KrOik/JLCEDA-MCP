/**
 * ------------------------------------------------------------------------
 * 名称：桥接器件选型任务处理
 * 说明：在 EDA 侧调用器件库搜索接口，返回候选器件列表供上层确认。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-24
 * 备注：仅处理 component/select 任务。
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord, parseBoundedIntegerValue, toSafeErrorMessage } from '../utils';

interface ComponentSelectCandidate {
	uuid: string;
	libraryUuid: string;
	name: string;
	symbolName: string;
	footprintName: string;
	description: string;
	manufacturer: string;
	manufacturerId: string;
	supplier: string;
	supplierId: string;
	lcscInventory: number;
	lcscPrice: number;
}

interface ComponentSelectRequest {
	protocol: string;
	title: string;
	description: string;
	candidates: ComponentSelectCandidate[];
	pageSize: number;
	currentPage: number;
}

interface LibDeviceApi {
	search: (
		keyword: string,
		libraryUuid?: string,
		classification?: unknown,
		symbolType?: unknown,
		itemsOfPage?: number,
		page?: number,
	) => Promise<unknown[]>;
}

const COMPONENT_SELECT_PROTOCOL = 'component-select/v1';
const COMPONENT_SELECT_DEFAULT_LIMIT = 20;

// 将搜索结果项映射为统一候选器件结构。
function mapDeviceSearchItem(raw: unknown): ComponentSelectCandidate {
	const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	return {
		uuid: String(item.uuid ?? '').trim(),
		libraryUuid: String(item.libraryUuid ?? item.libraryuuid ?? '').trim(),
		name: String(item.name ?? '').trim(),
		symbolName: String(item.symbolName ?? item.symbolname ?? '').trim(),
		footprintName: String(item.footprintName ?? item.footprintname ?? '').trim(),
		description: String(item.description ?? '').trim(),
		manufacturer: String(item.manufacturer ?? '').trim(),
		manufacturerId: String(item.manufacturerId ?? item.manufacturerid ?? '').trim(),
		supplier: String(item.supplier ?? '').trim(),
		supplierId: String(item.supplierId ?? item.supplierid ?? '').trim(),
		lcscInventory: Number(item.lcscInventory ?? item.lcscinventory ?? 0),
		lcscPrice: Number(item.lcscPrice ?? item.lcscprice ?? 0),
	};
}

// 读取 EDA 器件搜索接口。
function getLibDeviceApi(): LibDeviceApi {
	const libDevice = (eda as unknown as { lib_Device?: unknown }).lib_Device;
	if (!isPlainObjectRecord(libDevice) || typeof libDevice.search !== 'function') {
		throw new Error('未找到 eda.lib_Device.search API，请确认当前 EDA 版本支持器件库搜索。');
	}

	return libDevice as unknown as LibDeviceApi;
}

/**
 * 处理器件选型任务。
 * @param payload 任务参数。
 * @returns 候选器件列表。
 */
export async function handleComponentSelectTask(payload: unknown): Promise<unknown> {
	if (!isPlainObjectRecord(payload)) {
		throw new TypeError('component/select 任务参数必须为对象。');
	}

	const keyword = String(payload.keyword ?? '').trim();
	if (keyword.length === 0) {
		throw new Error('component_select 缺少 keyword 参数。');
	}

	const limit = parseBoundedIntegerValue(payload.limit, COMPONENT_SELECT_DEFAULT_LIMIT, 2, 20);
	const page = parseBoundedIntegerValue(payload.page, 1, 1, 9999);
	const libDevice = getLibDeviceApi();

	let rawResults: unknown[];
	try {
		rawResults = await libDevice.search(keyword, undefined, undefined, undefined, limit, page);
	}
	catch (error: unknown) {
		throw new Error(`器件搜索失败：${toSafeErrorMessage(error)}`);
	}

	if (!Array.isArray(rawResults) || rawResults.length === 0) {
		return {
			ok: false,
			error: `未在立创商城中找到匹配“${keyword}”的器件，请调整关键词后重试。`,
		};
	}

	const candidates = rawResults
		.map(mapDeviceSearchItem)
		.filter(item => item.uuid.length > 0 && item.libraryUuid.length > 0);

	if (candidates.length === 0) {
		return {
			ok: false,
			error: '搜索结果缺少必要的 uuid 或 libraryUuid 字段，无法继续选型。',
		};
	}

	const selection: ComponentSelectRequest = {
		protocol: COMPONENT_SELECT_PROTOCOL,
		title: `器件选型：${keyword}`,
		description: `以下是立创商城中“${keyword}”的搜索结果，请先确认具体型号后再继续放置。`,
		candidates,
		pageSize: limit,
		currentPage: page,
	};

	return {
		ok: true,
		selection,
	};
}
