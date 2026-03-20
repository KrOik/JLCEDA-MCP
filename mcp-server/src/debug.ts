/**
 * ------------------------------------------------------------------------
 * 名称：调试开关配置管理
 * 说明：集中管理系统日志与连接列表调试开关。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅处理数据，不直接调用 VS Code API，不包含视图模板。
 * ------------------------------------------------------------------------
 */

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
