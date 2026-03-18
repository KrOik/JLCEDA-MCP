/**
 * ------------------------------------------------------------------------
 * 名称：调试卡片配置与状态管理
 * 说明：集中管理系统日志与连接列表调试开关，以及会话内调试状态缓存。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅处理数据，不直接调用 VS Code API，不包含视图模板。
 * ------------------------------------------------------------------------
 */

import type { ServerStatus } from './server/core/status';
import { createServerStatusLogEntry, createServerStatusLogSignature } from './status-log';
import type { SidebarConnectedClientEntry, SidebarStatusLogEntry } from './ui/sidebar-protocol';

/**
 * 调试开关配置结构。
 */
export interface DebugSwitchValues {
  // 系统日志开关：关闭后不再发送系统日志，并隐藏系统日志选项卡。
  enableSystemLog: boolean;
  // 连接列表开关：关闭后不再发送连接信息日志，并隐藏连接列表选项卡。
  enableConnectionList: boolean;
  // 调试控制开关：关闭后隐藏手动启动 stdio 进程卡片。
  enableDebugControlCard: boolean;
}

/**
 * 调试开关（默认全部启用，由宿主进程或子进程在启动时根据配置注入实际值）。
 */
export const DEBUG_SWITCH: DebugSwitchValues = {
  enableSystemLog: false,
  enableConnectionList: false,
  enableDebugControlCard: false,
};

/**
 * 更新调试开关值。
 * @param values 新的调试开关配置。
 */
export function updateDebugSwitch(values: DebugSwitchValues): void {
  DEBUG_SWITCH.enableSystemLog = values.enableSystemLog;
  DEBUG_SWITCH.enableConnectionList = values.enableConnectionList;
  DEBUG_SWITCH.enableDebugControlCard = values.enableDebugControlCard;
}

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
 * 侧边栏调试状态管理器。
 */
export class SidebarDebugState {
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
