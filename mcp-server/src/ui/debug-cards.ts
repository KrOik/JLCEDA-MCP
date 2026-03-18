/**
 * ------------------------------------------------------------------------
 * 名称：调试卡片视图模板
 * 说明：根据调试开关配置生成侧边栏调试卡片 HTML 片段。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-14
 * 备注：仅负责 HTML 模板生成，不承载状态存储与业务逻辑。
 * ------------------------------------------------------------------------
 */

import { DEBUG_SWITCH } from '../debug';

/**
 * 构建调试卡片 HTML 片段。
 * @returns 系统日志与连接列表卡片 HTML。
 */
export function buildDebugCardsHtml(): string {
  const cards: string[] = [];

  if (DEBUG_SWITCH.enableSystemLog) {
    cards.push(`
      <div class="card log-card">
        <div class="card-inner status-panel">
          <div class="status-inner">
            <div id="statusLogToggle" class="section-header status-log-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="statusLogContent">
              <div class="section-title-row">
                <div class="section-title">系统日志[开发者]</div>
                <div class="section-title-actions">
                  <button id="clearStatusLogs" class="secondary status-log-clear-button" type="button">清空日志</button>
                  <div class="status-log-toggle-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <use href="#icon-chevron-down"></use>
                    </svg>
                  </div>
                </div>
              </div>
              <div class="section-description">显示当前会话中的桥接状态变化。</div>
            </div>
            <div id="statusLogContent" class="status-log-content">
              <div class="section-divider"></div>
              <div class="status-log-filters">
                <label for="statusLogLevelFilter" class="status-log-filter-label">级别</label>
                <select id="statusLogLevelFilter" class="status-log-filter-select">
                  <option value="all">全部</option>
                  <option value="info">信息</option>
                  <option value="success">成功</option>
                  <option value="warning">警告</option>
                  <option value="error">错误</option>
                </select>
                <label for="statusLogSourceFilter" class="status-log-filter-label">来源</label>
                <select id="statusLogSourceFilter" class="status-log-filter-select">
                  <option value="all">全部</option>
                  <option value="server">服务端</option>
                  <option value="client">客户端</option>
                </select>
                <button id="statusLogFieldToggle" class="status-log-field-toggle-btn" type="button" title="显示 / 隐藏字段开关">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 3h14v1.5H1V3zm2 4h10v1.5H3V7zm2 4h6v1.5H5V11z"/></svg>
                  <span>字段</span>
                </button>
              </div>
              <div id="statusLogFieldSwitches" class="status-log-field-switches"></div>
              <div class="status-log-box">
                <div id="statusLogEmpty" class="status-log-empty"></div>
                <div id="statusLogViewport" class="status-log-viewport" data-overlayscrollbars-initialize>
                  <div id="statusLogList" class="status-log-list"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  if (DEBUG_SWITCH.enableConnectionList) {
    cards.push(`
      <div class="card log-card">
        <div class="card-inner status-panel">
          <div class="status-inner">
            <div id="connectionListToggle" class="section-header status-log-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="connectionListContent">
              <div class="section-title-row">
                <div class="section-title">连接列表[开发者]</div>
                <div class="status-log-toggle-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <use href="#icon-chevron-down"></use>
                  </svg>
                </div>
              </div>
              <div class="section-description">显示当前活跃的 WebSocket 客户端。</div>
            </div>
            <div id="connectionListContent" class="status-log-content">
              <div class="section-divider"></div>
              <div class="status-log-box">
                <div id="connectionListEmpty" class="status-log-empty"></div>
                <div id="connectionListViewport" class="status-log-viewport connection-list-viewport" data-overlayscrollbars-initialize>
                  <div id="connectionList" class="status-log-list"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  if (DEBUG_SWITCH.enableDebugControlCard) {
    cards.push(`
      <div class="card log-card">
        <div class="card-inner status-panel">
          <div class="status-inner">
            <div class="section-header">
              <div class="section-title">调试控制[开发者]</div>
              <div class="section-description">手动启动 stdio 运行时进程，便于排查连接状态。</div>
            </div>
            <div class="section-divider"></div>
            <div class="buttons buttons-column">
              <button id="startStdioRuntime" class="secondary" type="button">手动启动 stdio 进程</button>
              <button id="stopStdioRuntime" class="secondary" type="button">停止手动 stdio 进程</button>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  return cards.join('\n');
}
