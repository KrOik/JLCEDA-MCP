/**
 * ------------------------------------------------------------------------
 * 名称：esbuild 通用配置
 * 说明：负责定义 VS Code 扩展宿主入口与 MCP 运行时入口的统一打包参数。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-10
 * 备注：仅保留 extension.ts 与 server/runtime.ts 两个入口，其余模块统一打包内联。
 * ------------------------------------------------------------------------
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 解析当前项目根目录，确保命令行从任意目录执行都能稳定定位入口文件。
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const commonConfig = {
	absWorkingDir: ROOT_DIR,
	entryPoints: [
		'./src/extension.ts',
		'./src/server/runtime.ts',
	],
	outbase: './src',
	outdir: './out',
	entryNames: '[dir]/[name]',
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	sourcemap: false,
	minify: false,
	treeShaking: true,
	charset: 'utf8',
	external: ['vscode'],
	tsconfig: './tsconfig.json',
	logLevel: 'info',
	loader: {
		'.md': 'text',
	},
};

export default commonConfig;