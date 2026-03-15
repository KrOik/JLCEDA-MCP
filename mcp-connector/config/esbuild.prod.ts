import process from 'node:process';
import esbuild from 'esbuild';

import common from './esbuild.common';

// 执行生产构建，传入 --watch 时切换为监听模式。
(async () => {
	const ctx = await esbuild.context(common);
	if (process.argv.includes('--watch')) {
		await ctx.watch();
	}
	else {
		await ctx.rebuild();
		process.exit();
	}
})();
