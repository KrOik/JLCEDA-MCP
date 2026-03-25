/**
 * ------------------------------------------------------------------------
 * 名称：桥接原理图网表分析任务处理
 * 说明：执行 ERC 检查并提取完整网表，供 AI 进行功能性审查与电路分析。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-25
 * 备注：无
 * ------------------------------------------------------------------------
 */

import { safeCall } from '../utils';

/**
 * 处理原理图功能性分析任务。
 * @param _payload 任务参数（当前未使用）。
 * @returns 分析结果，含 ERC 状态与完整网表文本。
 */
export async function handleSchematicNetlistTask(_payload: unknown): Promise<unknown> {
	// 第一步：ERC 电气规则检查。
	const ercRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_Drc.check(false, false, true)));
	const ercPassed = ercRaw === true;

	// 第二步：获取完整网表文件，提取网络连接关系供 AI 功能性分析。
	const netlistFileRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_ManufactureData.getNetlistFile()));
	if (!netlistFileRaw || typeof netlistFileRaw !== 'object') {
		return {
			ok: false,
			error: '网表文件获取失败，getNetlistFile 返回空值。',
			erc: { passed: ercPassed, rawResult: ercRaw },
		};
	}

	const netlistText = await safeCall<unknown>(() => Promise.resolve((netlistFileRaw as File).text()));
	if (typeof netlistText !== 'string') {
		return {
			ok: false,
			error: '网表内容读取失败。',
			erc: { passed: ercPassed, rawResult: ercRaw },
		};
	}

	return {
		ok: true,
		erc: { passed: ercPassed, rawResult: ercRaw },
		netlist: netlistText,
	};
}
