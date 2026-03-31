/**
 * ------------------------------------------------------------------------
 * 名称：Bridge 日志管道
 * 说明：统一管理桥接侧 Bridge 日志缓冲、过滤与冲刷。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-20
 * 备注：由 broker 调用，按调试开关输出增量日志。
 * ------------------------------------------------------------------------
 */

import type { BridgeDebugSwitch } from '../server/bridge/protocol';
import type { UnifiedLogEntry } from './server-log';
import { isConnectionInfoLog } from './server-log';

// 桥接日志缓冲上限。
const BRIDGE_LOG_LIMIT = 200;

/**
 * 桥接日志管道。
 */
export class BridgeLogPipeline {
	private readonly pendingBridgeLogs: UnifiedLogEntry[] = [];

	/**
	 * 追加一条客户端日志。
	 * @param logEntry 日志实体。
	 * @param debugSwitch 当前调试开关。
	 */
	public appendFromClient(logEntry: UnifiedLogEntry, debugSwitch: BridgeDebugSwitch): void {
		if (!debugSwitch.enableSystemLog) {
			return;
		}

		if (!debugSwitch.enableConnectionList && isConnectionInfoLog(logEntry)) {
			return;
		}

		this.pendingBridgeLogs.push(logEntry);
		if (this.pendingBridgeLogs.length > BRIDGE_LOG_LIMIT) {
			this.pendingBridgeLogs.splice(0, this.pendingBridgeLogs.length - BRIDGE_LOG_LIMIT);
		}
	}

	/**
	 * 取走当前缓冲中的日志并清空。
	 * @returns 增量日志数组。
	 */
	public flush(): UnifiedLogEntry[] {
		const flushed = this.pendingBridgeLogs.slice();
		this.pendingBridgeLogs.splice(0, this.pendingBridgeLogs.length);
		return flushed;
	}
}