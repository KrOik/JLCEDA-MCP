/**
 * ------------------------------------------------------------------------
 * 名称：服务端通用工具
 * 说明：提供服务端桥接与 MCP 运行时共享的基础工具函数。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅包含无业务副作用的纯工具函数。
 * ------------------------------------------------------------------------
 */

import * as path from 'path';

/**
 * 判断输入是否为普通对象。
 * @param value 待判断值。
 * @returns 是否为普通对象记录。
 */
export function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将未知异常转换为可读文本。
 * @param error 异常对象。
 * @returns 文本消息。
 */
export function toSafeErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 解析并校验整数参数。
 * @param value 输入值。
 * @param defaultValue 默认值。
 * @param min 最小值。
 * @param max 最大值。
 * @returns 合法整数。
 */
export function parseBoundedIntegerValue(value: unknown, defaultValue: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		return defaultValue;
	}

	if (value < min || value > max) {
		throw new Error(`整数参数超出范围，允许区间: ${min}-${max}。`);
	}

	return value;
}

/**
 * 解析运行时所在扩展根目录。
 * @returns 扩展根目录绝对路径。
 */
export function getExtensionRootPathFromRuntime(): string {
	const runtimeEntryPath = String(process.argv[1] ?? '').trim();
	if (runtimeEntryPath.length === 0) {
		return process.cwd();
	}

	return path.resolve(path.dirname(runtimeEntryPath), '..', '..');
}