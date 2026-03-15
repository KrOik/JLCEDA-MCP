/**
 * ------------------------------------------------------------------------
 * 名称：侧边栏消息协议
 * 说明：定义侧边栏 Webview 与扩展宿主之间的消息结构。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：供侧边栏视图与模板模块共享。
 * ------------------------------------------------------------------------
 */

import type { ServerConfig, ServerStatus } from '../server/core/status';
import type { UnifiedLogEntry, UnifiedLogFieldSchema } from '../status-log';

export type SidebarStatusLogEntry = UnifiedLogEntry;

/**
 * 侧边栏连接列表项。
 */
export interface SidebarConnectedClientEntry {
  clientId: string;
  role: 'active' | 'standby';
}

/**
 * 侧边栏发送到扩展宿主的消息结构。
 */
export type SidebarCommand =
  | { command: 'load' }
  | { command: 'save'; payload: ServerConfig }
  | { command: 'saveInstructions'; payload: string }
  | { command: 'copyBridgeAddress'; payload: string }
  | { command: 'copySelectedLog'; payload: string }
  | { command: 'copyAllLogs'; payload: string }
  | { command: 'clearLogs' }
  | { command: 'openEditor' }
  | { command: 'startStdioRuntime' }
  | { command: 'stopStdioRuntime' };

/**
 * 扩展宿主发送到侧边栏的消息结构。
 */
export type SidebarWebviewMessage =
  | { type: 'config'; payload: ServerConfig }
  | { type: 'state'; payload: ServerStatus }
  | { type: 'instructions'; payload: string }
  | { type: 'logSchema'; payload: UnifiedLogFieldSchema }
  | { type: 'logs'; payload: SidebarStatusLogEntry[] }
  | { type: 'clients'; payload: SidebarConnectedClientEntry[] };