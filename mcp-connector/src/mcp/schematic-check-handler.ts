/**
 * ------------------------------------------------------------------------
 * 名称：桥接原理图检查任务处理
 * 说明：固定执行 ERC + 网表获取 + 精简提取，将结果返回给 AI 分析。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-21
 * 备注：仅处理 schematic/check 任务。
 * ------------------------------------------------------------------------
 */

import { safeCall } from '../utils';

// 精简网表：按实际 enet 字段名提取 AI 分析所需的最小数据集，去掉冗余 ID 和 props 子对象。
function extractCompactNetlist(netlistJson: string): { ok: true; data: string } | { ok: false; error: string } {
	let parsed: any;
	try {
		parsed = JSON.parse(netlistJson);
	}
	catch {
		return { ok: false, error: '网表 JSON 解析失败，请确认原理图已保存。' };
	}

	if (!parsed || typeof parsed !== 'object' || !parsed.components) {
		return { ok: false, error: '网表结构异常，缺少 components 字段。' };
	}

	// 按实际 enet 格式字段名提取，只保留 AI 分析必需的字段。
	const components: Array<{
		reference: string;
		name: string;
		footprint: string;
		pins: Array<{ name: string; number: string; net: string }>;
	}> = [];

	for (const [, rawComp] of Object.entries<any>(parsed.components)) {
		// props 字段：Designator = 位号，DeviceName = 器件名，FootprintName = 封装名。
		const props = rawComp?.props ?? {};
		const reference = String(props.Designator ?? '');
		const name = String(props.DeviceName ?? '');
		const footprint = String(props.FootprintName ?? '');

		// pinInfoMap 字段：name = 引脚名，number = 引脚编号，net = 所连网络名。
		const pinInfoMap = rawComp?.pinInfoMap ?? {};
		const pins: Array<{ name: string; number: string; net: string }> = [];
		for (const [, rawPin] of Object.entries<any>(pinInfoMap)) {
			pins.push({
				name: String(rawPin?.name ?? ''),
				number: String(rawPin?.number ?? ''),
				net: String(rawPin?.net ?? ''),
			});
		}

		components.push({ reference, name, footprint, pins });
	}

	return { ok: true, data: JSON.stringify({ components }) };
}

/**
 * 处理原理图检查任务。
 * @param _payload 任务参数（当前未使用）。
 * @returns 检查结果，含 ERC 状态与精简网表。
 */
export async function handleSchematicCheckTask(_payload: unknown): Promise<unknown> {
	// 第一步：ERC 电气规则检查。
	const ercRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_Drc.check(false, false, true)));
	const ercPassed = ercRaw === true;

	// 第二步：获取原理图网表。
	const netlistRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_ManufactureData.getNetlistFile()));
	if (netlistRaw === null || netlistRaw === undefined) {
		return {
			ok: false,
			error: '网表获取失败，请确认当前已打开原理图并已保存。',
			erc: { passed: ercPassed, rawResult: ercRaw },
		};
	}

	// 网表可能为 Blob（含 .text() 方法）或字符串。
	let netlistText = '';
	const netlistRawAny = netlistRaw as any;
	if (typeof netlistRaw === 'string') {
		netlistText = netlistRaw;
	}
	else if (typeof netlistRawAny.text === 'function') {
		netlistText = await netlistRawAny.text();
	}
	else {
		netlistText = JSON.stringify(netlistRaw);
	}

	if (!netlistText || !netlistText.trim()) {
		return {
			ok: false,
			error: '网表内容为空，请确认原理图已保存且包含元件。',
			erc: { passed: ercPassed, rawResult: ercRaw },
		};
	}

	// 第三步：精简提取网表，去掉冗余字段后返回给 AI。
	const extracted = extractCompactNetlist(netlistText);
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
		netlist: extracted.data,
	};
}
