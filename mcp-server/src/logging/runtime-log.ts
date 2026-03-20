/**
 * ------------------------------------------------------------------------
 * 名称：运行时日志管道
 * 说明：统一封装运行时结构化日志的构建与输出。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-20
 * 备注：输出目标固定为 stderr，供宿主采集。
 * ------------------------------------------------------------------------
 */

import {
	createRuntimeLogEntry,
	formatUnifiedLogOutput,
} from './server-log';
import type { UnifiedLogLevel } from './server-log';

/**
 * 运行时日志附加字段。
 */
export interface RuntimeLogExtra {
	runtimeStatus?: string;
	bridgeStatus?: string;
	contextKey?: string;
	leaseTerm?: string;
	bridgeClientCount?: string;
	detail?: string;
	errorCode?: string;
	clientId?: string;
	activeClientId?: string;
	disconnectType?: string;
	disconnectActor?: string;
	disconnectClientRole?: string;
	disconnectCloseCode?: string;
	disconnectCloseReason?: string;
	disconnectDurationMs?: string;
	disconnectOccurredAt?: string;
}

/**
 * 运行时日志管道。
 */
export class RuntimeLogPipeline {
	public constructor(
		private readonly host: string,
		private readonly port: number,
	) {}

	/**
	 * 写入运行时日志。
	 * @param level 日志级别。
	 * @param event 事件标识。
	 * @param summary 摘要。
	 * @param message 消息。
	 * @param extra 附加字段。
	 */
	public write(level: UnifiedLogLevel, event: string, summary: string, message: string, extra: RuntimeLogExtra = {}): void {
		const entry = createRuntimeLogEntry({
			level,
			event,
			summary,
			message,
			host: this.host,
			port: this.port,
			runtimeStatus: extra.runtimeStatus,
			bridgeStatus: extra.bridgeStatus,
			contextKey: extra.contextKey,
			leaseTerm: extra.leaseTerm,
			bridgeClientCount: extra.bridgeClientCount,
			detail: extra.detail,
			errorCode: extra.errorCode,
			clientId: extra.clientId,
			activeClientId: extra.activeClientId,
			disconnectType: extra.disconnectType,
			disconnectActor: extra.disconnectActor,
			disconnectClientRole: extra.disconnectClientRole,
			disconnectCloseCode: extra.disconnectCloseCode,
			disconnectCloseReason: extra.disconnectCloseReason,
			disconnectDurationMs: extra.disconnectDurationMs,
			disconnectOccurredAt: extra.disconnectOccurredAt,
		});

		process.stderr.write(`${formatUnifiedLogOutput(entry)}\n`);
	}
}
