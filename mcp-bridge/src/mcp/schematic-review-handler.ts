/**
 * ------------------------------------------------------------------------
 * 名称：桥接全工程原理图审查任务处理
 * 说明：调用 sch_ManufactureData.getNetlistFile 获取全工程（所有原理图页面）的网表文件，
 *       将网表文本直接输出供 AI 分析，覆盖多页原理图的所有器件与网络连接关系。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-31
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord, safeCall } from '../utils';

/**
 * 处理全工程原理图审查任务。
 * @param _payload 任务参数（当前未使用）。
 * @returns 读取结果，含全工程网表文本。
 */
export async function handleSchematicReviewTask(_payload: unknown): Promise<unknown> {
	// ── 第一步：执行 DRC 检查 ────────────────────────────────────────────────
	// Request the boolean overload explicitly; verbose mode returns an array in newer SDKs.
	const drcRawResult = await safeCall<unknown>(() => Promise.resolve(eda.sch_Drc.check(true, false, false)));
	const drcCheckPassed = drcRawResult === true;

	// ── 第二步：获取全工程网表 ───────────────────────────────────────────────
	const netlistFile: unknown = await safeCall<unknown>(() => Promise.resolve(eda.sch_ManufactureData.getNetlistFile()));
	if (!netlistFile) {
		return {
			ok: false,
			error: '网表文件获取失败，sch_ManufactureData.getNetlistFile 返回空。',
		};
	}

	const netlistFileObj = netlistFile as { text?: () => Promise<string> };
	if (typeof netlistFileObj.text !== 'function') {
		return { ok: false, error: '网表文件对象格式异常，无法读取文本内容。' };
	}

	const netlistText: string = await netlistFileObj.text();
	if (!netlistText || netlistText.trim().length === 0) {
		return { ok: false, error: '网表文件内容为空，请确认原理图不为空。' };
	}

	const warnings: string[] = [];
	if (typeof drcRawResult !== 'boolean')
		warnings.push('DRC 未返回有效检查结果，不能判定通过。');
	try {
		const netlist: unknown = JSON.parse(netlistText);
		if (!isPlainObjectRecord(netlist) || !isPlainObjectRecord(netlist.components))
			throw new Error('unknown netlist format');
		const entries = Object.entries(netlist.components);
		if (!entries.length)
			warnings.push('网表没有器件，不能据此判断设计完成。');
		if (entries.some(([id, value]) => !id.trim() || (isPlainObjectRecord(value) && isPlainObjectRecord(value.props)
			&& (!String(value.props['Unique ID'] ?? '').trim() || !String(value.props.Designator ?? '').trim() || String(value.props.Designator).includes('?')))))
			warnings.push('网表存在空唯一 ID 或未编号器件，可能缺失/覆盖器件记录；先完成编号并重新导出，不能据此验收。');
		const pins = entries.flatMap(([, value]) => isPlainObjectRecord(value) && isPlainObjectRecord(value.pinInfoMap) ? Object.values(value.pinInfoMap) : []);
		if (!pins.some(pin => isPlainObjectRecord(pin) && typeof pin.net === 'string' && pin.net.trim()))
			warnings.push('网表没有可识别的已连接引脚；不能把图元创建或 DRC 结果当作连接完成。');
	}
	catch {
		warnings.push('未识别网表结构，请直接核对原始网表中的目标引脚连接。');
	}
	return {
		ok: true,
		drcCheckPassed,
		drcStrict: true,
		warnings,
		netlistText,
	};
}
