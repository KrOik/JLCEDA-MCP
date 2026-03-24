/**
 * ------------------------------------------------------------------------
 * 名称：桥接器件放置任务处理
 * 说明：校验待放置器件参数并返回交互放置任务描述。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-24
 * 备注：仅处理 component/place 任务。
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord } from '../utils';

interface ComponentPlaceItem {
	uuid: string;
	libraryUuid: string;
	name: string;
	footprintName: string;
	subPartName: string;
}

interface ComponentPlaceRequest {
	protocol: string;
	title: string;
	description: string;
	components: ComponentPlaceItem[];
	timeoutSeconds: number;
	retryCount: number;
}

const COMPONENT_PLACE_PROTOCOL = 'component-place/v1';

// 规范化单个待放置器件参数。
function normalizeComponentPlaceItem(raw: unknown, index: number): ComponentPlaceItem {
	if (!isPlainObjectRecord(raw)) {
		throw new TypeError(`components[${String(index)}] 必须为对象。`);
	}

	const uuid = String(raw.uuid ?? '').trim();
	const libraryUuid = String(raw.libraryUuid ?? '').trim();
	if (uuid.length === 0) {
		throw new Error(`components[${String(index)}].uuid 不能为空。`);
	}
	if (libraryUuid.length === 0) {
		throw new Error(`components[${String(index)}].libraryUuid 不能为空。`);
	}

	return {
		uuid,
		libraryUuid,
		name: String(raw.name ?? '').trim(),
		footprintName: String(raw.footprintName ?? '').trim(),
		subPartName: String(raw.subPartName ?? '').trim(),
	};
}

// 解析超时参数。
function resolveTimeoutSeconds(rawValue: unknown): number {
	if (rawValue === undefined || rawValue === null || rawValue === '') {
		return 60;
	}

	const timeoutSeconds = Number(rawValue);
	if (!Number.isFinite(timeoutSeconds)) {
		throw new TypeError('timeoutSeconds 必须为数字。');
	}
	if (!Number.isInteger(timeoutSeconds)) {
		throw new TypeError('timeoutSeconds 必须为整数。');
	}
	if (timeoutSeconds < 30 || timeoutSeconds > 180) {
		throw new Error('timeoutSeconds 超出允许范围，必须在 30 到 180 秒之间。');
	}

	return timeoutSeconds;
}

/**
 * 处理器件放置任务。
 * @param payload 任务参数。
 * @returns 交互放置任务描述。
 */
export async function handleComponentPlaceTask(payload: unknown): Promise<unknown> {
	if (!isPlainObjectRecord(payload)) {
		throw new TypeError('component/place 任务参数必须为对象。');
	}

	const rawComponents = payload.components;
	if (!Array.isArray(rawComponents)) {
		throw new TypeError('缺少 components 参数，且其必须为数组。');
	}
	if (rawComponents.length < 1) {
		throw new Error('components 不能为空，至少需要提供一个待放置器件。');
	}
	if (rawComponents.length > 50) {
		throw new Error('components 数量过多，单次最多允许 50 个器件。');
	}

	const timeoutSeconds = resolveTimeoutSeconds(payload.timeoutSeconds);
	const components = rawComponents.map((item: unknown, index: number) => normalizeComponentPlaceItem(item, index));

	const placement: ComponentPlaceRequest = {
		protocol: COMPONENT_PLACE_PROTOCOL,
		title: '原理图器件放置',
		description: `请按顺序在原理图中放置以下 ${String(components.length)} 个器件。单个器件超时后，工具会在当前尝试结束后自动重试 1 次。`,
		components,
		timeoutSeconds,
		retryCount: 1,
	};

	return {
		ok: true,
		placement,
		message: `已创建 ${String(components.length)} 个器件的交互放置任务。`,
	};
}
