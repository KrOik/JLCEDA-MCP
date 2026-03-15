/**
 * ------------------------------------------------------------------------
 * 名称：stdio 行传输层
 * 说明：负责读取标准输入 JSON 行并写出标准输出响应。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅处理 stdio 传输，不处理协议分发。
 * ------------------------------------------------------------------------
 */

import * as readline from 'readline';

export interface StdioLineTransport {
	start: () => void;
	write: (payload: unknown) => void;
}

/**
 * 创建 stdio 行传输对象。
 * @param onLine 收到单行输入后的回调。
 * @returns 传输对象。
 */
export function createStdioLineTransport(onLine: (line: string) => Promise<void>): StdioLineTransport {
	let requestChain: Promise<void> = Promise.resolve();

	return {
		start: () => {
			const reader = readline.createInterface({
				input: process.stdin,
				crlfDelay: Infinity,
				terminal: false,
			});

			reader.on('line', (line) => {
				requestChain = requestChain.then(async () => {
					await onLine(line);
				}).catch((error: unknown) => {
					process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
				});
			});
		},
		write: (payload: unknown) => {
			process.stdout.write(`${JSON.stringify(payload)}\n`);
		},
	};
}
