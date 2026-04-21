/**
 * ------------------------------------------------------------------------
 * 名称：侧边栏页面模板
 * 说明：负责生成侧边栏 Webview 的 HTML、样式和前端交互脚本。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：仅负责视图模板，不处理扩展宿主业务逻辑。
 * ------------------------------------------------------------------------
 */

import type * as vscode from 'vscode';
import { DEBUG_SWITCH } from '../debug';
import { buildDebugCardsHtml } from './debug-cards';
import { buildSidebarBodyContent } from './html/sidebar-body';
import { resolveSidebarTemplateAssets } from './html/sidebar-template-assets';
import { buildSidebarScript } from './html/sidebar-script';
import { SIDEBAR_STYLE } from './html/sidebar-style';

/**
 * 构建侧边栏 Webview HTML。
 * @param webview 目标 Webview 实例。
 * @param extensionUri 扩展安装目录 URI。
 * @returns 完整 HTML 文本。
 */
export function buildSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const assets = resolveSidebarTemplateAssets(webview, extensionUri);
  const bodyContent = buildSidebarBodyContent({
    iconsSpriteMarkup: assets.iconsSpriteMarkup,
    debugCardsHtml: buildDebugCardsHtml(),
  });
  const inlineScript = buildSidebarScript({
    enableSystemLog: DEBUG_SWITCH.enableSystemLog,
    enableConnectionList: DEBUG_SWITCH.enableConnectionList,
    enableDebugControlCard: DEBUG_SWITCH.enableDebugControlCard,
  });

  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${assets.cspSource} 'unsafe-inline'; script-src ${assets.cspSource} 'nonce-${assets.nonce}'; img-src ${assets.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JLCEDA MCP 服务管理</title>
  <link rel="stylesheet" href="${assets.overlayScrollbarsCssUri}" />
  <style>
${SIDEBAR_STYLE}
  </style>
</head>
${bodyContent}
  <script nonce="${assets.nonce}" src="${assets.overlayScrollbarsScriptUri}"></script>
  <script nonce="${assets.nonce}">
${inlineScript}
  </script>
</body>
</html>`;
}
