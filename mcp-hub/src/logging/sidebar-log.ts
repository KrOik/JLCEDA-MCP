/**
 * ------------------------------------------------------------------------
 * 名称：侧边栏日志管道
 * 说明：统一处理侧边栏日志的去重、抑制、缓存与连接列表签名。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-20
 * 备注：仅处理日志管道与列表签名，不直接访问 Webview。
 * ------------------------------------------------------------------------
 */

import { createServerStatusLogEntry, createServerStatusLogSignature } from '../state/status-log-mapper';
import type { ServerStatus } from '../state/status';
import type { SidebarConnectedClientEntry, SidebarStatusLogEntry } from '../sidebar/sidebar-protocol';

// 调试日志最多缓存条数。
const DEBUG_STATUS_LOG_LIMIT = 200;
// 普通重复日志抑制窗口，单位毫秒。
const DEBUG_LOG_DUP_WINDOW_MS = 1500;
// 高频噪音日志抑制窗口，单位毫秒。
const DEBUG_LOG_NOISE_WINDOW_MS = 8000;
// 高频噪音事件集合。
const DEBUG_LOG_NOISE_EVENTS = new Set([
	'status.bridge.waiting',
	'status.connecting',
	'status.failed',
	'bridge.context.sync.failed',
]);
// 高频噪音关键字集合。
const DEBUG_LOG_NOISE_TOKENS = ['心跳', '重连', '无响应', '连接失败，系统将自动重试'];

/**
 * 侧边栏日志管道。
 */
export class SidebarLogPipeline {
	private readonly statusLogs: SidebarStatusLogEntry[] = [];
	private readonly knownLogIds = new Set<string>();
	private readonly logReportAtByKey = new Map<string, number>();
	private lastStatusLogSignature = '';
	private lastConnectedClientsSignature = '';
	// 上一次轮询时的客户端 ID 列表，用于 diff 出本次新增或移除的客户端。
	private lastBridgeClientIds: string[] = [];

	// 统一维护日志上限与索引。
	private trimLogsToLimit(): void {
		if (this.statusLogs.length > DEBUG_STATUS_LOG_LIMIT) {
			this.statusLogs.splice(0, this.statusLogs.length - DEBUG_STATUS_LOG_LIMIT);
		}

		this.knownLogIds.clear();
		for (const logEntry of this.statusLogs) {
			const logId = String(logEntry.id ?? '').trim();
			if (logId.length > 0) {
				this.knownLogIds.add(logId);
			}
		}
	}

	// 生成日志去重键。
	private createLogKey(logEntry: SidebarStatusLogEntry): string {
		const fields = logEntry.fields;
		return [
			String(fields.module ?? '').trim(),
			String(fields.event ?? '').trim(),
			String(fields.summary ?? '').trim(),
			String(fields.message ?? '').trim(),
			String(fields.detail ?? '').trim(),
			String(fields.errorCode ?? '').trim(),
		].join('|');
	}

	// 判断日志是否属于高频噪音。
	private isNoiseLog(logEntry: SidebarStatusLogEntry): boolean {
		const fields = logEntry.fields;
		const event = String(fields.event ?? '').trim();
		if (DEBUG_LOG_NOISE_EVENTS.has(event)) {
			return true;
		}

		const mergedText = [fields.summary, fields.message, fields.detail]
			.map((value) => String(value ?? '').trim())
			.filter((value) => value.length > 0)
			.join(' ');
		return DEBUG_LOG_NOISE_TOKENS.some((token) => mergedText.includes(token));
	}

	// 判断日志是否应被抑制。
	private shouldSuppressLog(logEntry: SidebarStatusLogEntry): boolean {
		const logKey = this.createLogKey(logEntry);
		if (logKey.length === 0) {
			return false;
		}

		const now = Date.now();
		const lastReportAt = this.logReportAtByKey.get(logKey) ?? 0;
		const windowMs = this.isNoiseLog(logEntry) ? DEBUG_LOG_NOISE_WINDOW_MS : DEBUG_LOG_DUP_WINDOW_MS;
		if (lastReportAt > 0 && now - lastReportAt < windowMs) {
			return true;
		}

		this.logReportAtByKey.set(logKey, now);
		if (this.logReportAtByKey.size > 800) {
			for (const [key, timestamp] of this.logReportAtByKey.entries()) {
				if (now - timestamp > DEBUG_LOG_NOISE_WINDOW_MS * 2) {
					this.logReportAtByKey.delete(key);
				}
			}
		}

		return false;
	}

	/**
	 * 当状态签名发生变化时追加一条连接状态日志。
	 * @param state 当前运行状态。
	 * @param clients 当前已连接的客户端列表（首位为活动客户端）。
	 * @returns 是否产生了新日志。
	 */
	public appendStatusLogIfChanged(state: ServerStatus, clients: SidebarConnectedClientEntry[]): boolean {
		const bridgeClientIds = clients.map((client) => client.clientId);
		const signature = createServerStatusLogSignature(state, bridgeClientIds);
		if (signature === this.lastStatusLogSignature) {
			return false;
		}

		// 通过对比前后客户端列表，找出触发本次状态变更的具体客户端（新连入或刚断开的那个）。
		const prevIdSet = new Set(this.lastBridgeClientIds);
		const newIdSet = new Set(bridgeClientIds);
		const addedId = bridgeClientIds.find((id) => !prevIdSet.has(id));
		const removedId = this.lastBridgeClientIds.find((id) => !newIdSet.has(id));
		const changedClientId = addedId ?? removedId ?? bridgeClientIds[0] ?? '';

		this.lastStatusLogSignature = signature;
		this.lastBridgeClientIds = bridgeClientIds;
		const logEntry = createServerStatusLogEntry(state, bridgeClientIds, changedClientId);
		const logId = String(logEntry.id ?? '').trim();
		if (logId.length > 0 && this.knownLogIds.has(logId)) {
			return false;
		}
		if (this.shouldSuppressLog(logEntry)) {
			return false;
		}

		this.statusLogs.push(logEntry);
		if (logId.length > 0) {
			this.knownLogIds.add(logId);
		}
		this.trimLogsToLimit();

		return true;
	}

	/**
	 * 合并外部日志。
	 * @param logs 外部日志数组。
	 * @returns 是否有新日志被追加。
	 */
	public appendExternalLogs(logs: SidebarStatusLogEntry[]): boolean {
		let changed = false;
		for (const logEntry of logs) {
			const logId = String(logEntry.id ?? '').trim();
			if (logId.length === 0 || this.knownLogIds.has(logId)) {
				continue;
			}
			if (this.shouldSuppressLog(logEntry)) {
				continue;
			}

			this.statusLogs.push(logEntry);
			this.knownLogIds.add(logId);
			changed = true;
		}

		if (changed) {
			this.trimLogsToLimit();
		}

		return changed;
	}

	/**
	 * 获取当前会话日志快照。
	 * @returns 连接状态日志数组副本。
	 */
	public getStatusLogs(): SidebarStatusLogEntry[] {
		return this.statusLogs.slice();
	}

	/**
	 * 清空当前会话日志。
	 */
	public clearStatusLogs(): void {
		this.statusLogs.splice(0, this.statusLogs.length);
		this.knownLogIds.clear();
		this.logReportAtByKey.clear();
		// lastStatusLogSignature 不重置：防止状态未发生真实变化时清空后立即产生新日志条目。
	}

	/**
	 * 判断连接列表是否发生变化。
	 * @param clients 最新连接列表。
	 * @returns 列表变化时返回 true。
	 */
	public shouldPostClients(clients: SidebarConnectedClientEntry[]): boolean {
		const signature = clients.map((client) => `${client.role}:${client.clientId}`).join('\n');
		if (signature === this.lastConnectedClientsSignature) {
			return false;
		}

		this.lastConnectedClientsSignature = signature;
		return true;
	}

	/**
	 * 重置连接列表签名缓存，确保新视图首次同步会推送连接列表。
	 */
	public resetClientsSignature(): void {
		this.lastConnectedClientsSignature = '';
	}
}
