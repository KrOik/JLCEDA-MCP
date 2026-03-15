/**
 * ------------------------------------------------------------------------
 * 名称：esbuild 生产构建入口
 * 说明：负责执行 MCP 服务端扩展的生产构建，并支持按需切换到 watch 模式。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-10
 * 备注：默认执行一次构建；传入 --watch 时保持监听重建。
 * ------------------------------------------------------------------------
 */

import process from 'node:process';
import esbuild from 'esbuild';
import commonConfig from './esbuild.common.mjs';

// 根据命令行参数判断是否启用监听模式。
const watchModeEnabled = process.argv.includes('--watch');

const buildContext = await esbuild.context(commonConfig);

if (watchModeEnabled) {
	await buildContext.watch();
}
else {
	await buildContext.rebuild();
	await buildContext.dispose();
}