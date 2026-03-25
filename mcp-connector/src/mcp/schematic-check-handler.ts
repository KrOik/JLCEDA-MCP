/**
 * ------------------------------------------------------------------------
 * 名称：桥接原理图检查任务处理
 * 说明：固定执行 ERC + 原理图拓扑快照提取，将结果返回给 AI 分析。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-21
 * 备注：仅处理 schematic/check 任务。
 * ------------------------------------------------------------------------
 */

import { safeCall } from '../utils';

// 安全调用同步 getter 方法，获取指定类型的值。
function sg<T>(obj: unknown, method: string, fallback: T): T {
	try {
		const fn = (obj as Record<string, unknown>)?.[method];
		if (typeof fn === 'function') {
			const result: unknown = (fn as () => unknown).call(obj);
			return result as T;
		}
	} catch (_e: unknown) { /* ignore */ }
	return fallback;
}

// 按当前原理图器件图元构建原理图拓扑快照，包含连线分析所需的器件、引脚与几何信息。
async function extractSchematicTopology(): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
	const componentListRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_PrimitiveComponent.getAll(undefined, true)));
	if (!Array.isArray(componentListRaw)) {
		return { ok: false, error: '器件列表获取失败，sch_PrimitiveComponent.getAll 未返回数组。' };
	}

	const components: Array<{
		primitiveId: string;
		reference: string;
		name: string;
		x: number;
		y: number;
		rotation: number;
		mirror: boolean;
		footprintUuid: string;
		subPartName: string;
		pins: Array<{
			primitiveId: string;
			pinName: string;
			pinNumber: string;
			pinType: string;
			x: number;
			y: number;
			rotation: number;
			pinLength: number;
			noConnected: boolean;
		}>;
	}> = [];

	for (const rawComponent of componentListRaw) {
		const reference = sg<string>(rawComponent, 'getState_Designator', '');
		// 跳过没有位号的虚拟器件。
		if (!reference) continue;

		const primitiveId = sg<string>(rawComponent, 'getState_PrimitiveId', '');
		const footprintRaw = await safeCall<unknown>(() => Promise.resolve((rawComponent as any).getState_Footprint()));
		const footprintUuid = footprintRaw && typeof footprintRaw === 'object'
			? String((footprintRaw as { uuid?: unknown }).uuid ?? '')
			: '';

		const pinsRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId)));
		if (pinsRaw !== undefined && !Array.isArray(pinsRaw)) {
			return { ok: false, error: `器件 ${reference} 的引脚列表格式异常。` };
		}

		const pins: Array<{
			primitiveId: string;
			pinName: string;
			pinNumber: string;
			pinType: string;
			x: number;
			y: number;
			rotation: number;
			pinLength: number;
			noConnected: boolean;
		}> = [];
		for (const rawPin of Array.isArray(pinsRaw) ? pinsRaw : []) {
			pins.push({
				primitiveId: sg<string>(rawPin, 'getState_PrimitiveId', ''),
				pinName: sg<string>(rawPin, 'getState_PinName', ''),
				pinNumber: sg<string>(rawPin, 'getState_PinNumber', ''),
				pinType: sg<string>(rawPin, 'getState_PinType', ''),
				x: sg<number>(rawPin, 'getState_X', 0),
				y: sg<number>(rawPin, 'getState_Y', 0),
				rotation: sg<number>(rawPin, 'getState_Rotation', 0),
				pinLength: sg<number>(rawPin, 'getState_PinLength', 0),
				noConnected: sg<boolean>(rawPin, 'getState_NoConnected', false),
			});
		}

		components.push({
			primitiveId,
			reference,
			name: sg<string>(rawComponent, 'getState_Name', ''),
			x: sg<number>(rawComponent, 'getState_X', 0),
			y: sg<number>(rawComponent, 'getState_Y', 0),
			rotation: sg<number>(rawComponent, 'getState_Rotation', 0),
			mirror: sg<boolean>(rawComponent, 'getState_Mirror', false),
			footprintUuid,
			subPartName: sg<string>(rawComponent, 'getState_SubPartName', ''),
			pins,
		});
	}

	return { ok: true, data: JSON.stringify({ components }) };
}

/**
 * 处理原理图检查任务。
 * @param _payload 任务参数（当前未使用）。
 * @returns 检查结果，含 ERC 状态与原理图拓扑快照。
 */
export async function handleSchematicCheckTask(_payload: unknown): Promise<unknown> {
	// 第一步：ERC 电气规则检查。
	const ercRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_Drc.check(false, false, true)));
	const ercPassed = ercRaw === true;

	// 第二步：构建原理图拓扑快照，包含连线分析所需的器件与引脚信息。
	const extracted = await extractSchematicTopology();
	if (!extracted.ok) {
		return {
			ok: false,
			error: extracted.error,
			erc: { passed: ercPassed, rawResult: ercRaw },
		};
	}

	return {
		ok: true,
		erc: { passed: ercPassed, rawResult: ercRaw },
		schematicTopology: extracted.data,
	};
}
