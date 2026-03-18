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

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { DEBUG_SWITCH } from '../debug';
import { buildDebugCardsHtml } from './debug-cards';

/**
 * 构建侧边栏 Webview HTML。
 * @param webview 目标 Webview 实例。
 * @param extensionUri 扩展安装目录 URI。
 * @returns 完整 HTML 文本。
 */
export function buildSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomUUID();
  const cspSource = webview.cspSource;
  const overlayScrollbarsCssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'overlayscrollbars', 'styles', 'overlayscrollbars.css'));
  const overlayScrollbarsScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'overlayscrollbars', 'browser', 'overlayscrollbars.browser.es6.js'));
  const iconsSpriteFilePath = path.join(extensionUri.fsPath, 'resources', 'icons.svg');
  const iconsSpriteMarkup = fs.readFileSync(iconsSpriteFilePath, 'utf8').replace(/^\uFEFF?/, '').replace(/<\?xml[^>]*>\s*/i, '');
  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}'; img-src ${cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>嘉立创 EDA MCP 服务管理</title>
  <link rel="stylesheet" href="${overlayScrollbarsCssUri}" />
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --text: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --danger: var(--vscode-inputValidation-errorBorder, #f14c4c);
      --ok: var(--vscode-testing-iconPassed, #73c991);
      --panel-input-bg: color-mix(in srgb, var(--vscode-editorWidget-background, var(--bg)) 90%, var(--bg));
      --panel-status-bg: color-mix(in srgb, var(--vscode-editorWidget-background, var(--bg)) 90%, #ffffff);
      --status-log-viewport-bg: color-mix(in srgb, var(--panel-status-bg) 88%, #ffffff);
      --status-log-item-hover-bg: color-mix(in srgb, var(--text) 4%, transparent);
      --status-title-bg: color-mix(in srgb, var(--panel-status-bg) 72%, var(--text));
      --status-title-fg: var(--text);
      --status-title-border: color-mix(in srgb, var(--text) 14%, transparent);
      --status-title-shadow: none;
      --status-idle-fg: color-mix(in srgb, var(--text) 78%, transparent);
      --status-starting-fg: #b67a18;
      --status-ready-fg: #1f8b4c;
      --status-connected-fg: #1f8b4c;
      --status-waiting-fg: #b67a18;
      --status-stopped-fg: var(--text);
      --status-error-fg: #c42b1c;
      --panel-border: color-mix(in srgb, var(--text) 12%, var(--bg));
      --panel-shadow: none;
      --panel-radius: 6px;
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border);
      --btn-primary-bg: var(--vscode-button-background);
      --btn-primary-hover: var(--vscode-button-hoverBackground);
      --btn-primary-active: color-mix(in srgb, var(--vscode-button-background) 84%, #000000);
      --btn-primary-fg: var(--vscode-button-foreground);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground);
      --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground);
      --btn-secondary-active: color-mix(in srgb, var(--vscode-button-secondaryBackground) 84%, #000000);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground);
      --save-enabled-bg: color-mix(in srgb, var(--btn-secondary-bg) 86%, #000000);
      --save-enabled-hover: color-mix(in srgb, var(--btn-secondary-hover) 84%, #000000);
      --save-shared-bg: color-mix(in srgb, var(--btn-secondary-bg) 68%, var(--bg));
      --save-enabled-active: var(--save-shared-bg);
      --save-enabled-fg: var(--btn-secondary-fg);
      --save-disabled-bg: var(--save-shared-bg);
      --save-disabled-fg: color-mix(in srgb, var(--btn-secondary-fg) 50%, var(--bg));
    }
    body.vscode-dark {
      --panel-input-bg: color-mix(in srgb, var(--bg) 83%, #000000);
      --panel-status-bg: color-mix(in srgb, var(--bg) 97%, #ffffff);
      --status-log-viewport-bg: color-mix(in srgb, var(--panel-status-bg) 92%, #000000);
      --status-log-item-hover-bg: color-mix(in srgb, #ffffff 4%, transparent);
      --status-title-bg: color-mix(in srgb, var(--bg) 93%, #ffffff);
      --status-title-fg: color-mix(in srgb, var(--text) 66%, var(--bg));
      --status-title-border: color-mix(in srgb, #ffffff 6%, transparent);
      --status-title-shadow: none;
      --status-idle-fg: color-mix(in srgb, var(--text) 76%, #ffffff);
      --status-starting-fg: #f2b14a;
      --status-ready-fg: #4fdc8a;
      --status-connected-fg: #4fdc8a;
      --status-waiting-fg: #f2b14a;
      --status-stopped-fg: color-mix(in srgb, var(--text) 86%, #ffffff);
      --status-error-fg: #ff7b72;
      --panel-border: color-mix(in srgb, #ffffff 7%, var(--bg));
      --panel-shadow: none;
      --input-bg: color-mix(in srgb, var(--bg) 92%, #000000);
      --input-border: color-mix(in srgb, var(--vscode-input-border, #3c3c3c) 86%, #000000);
      --btn-secondary-bg: color-mix(in srgb, var(--vscode-button-secondaryBackground) 90%, #ffffff);
      --btn-secondary-hover: color-mix(in srgb, var(--vscode-button-secondaryHoverBackground) 94%, #ffffff);
      --save-enabled-bg: color-mix(in srgb, var(--btn-secondary-bg) 80%, #ffffff);
      --save-enabled-hover: color-mix(in srgb, var(--btn-secondary-hover) 82%, #ffffff);
      --save-shared-bg: color-mix(in srgb, var(--btn-secondary-bg) 52%, var(--bg));
      --save-enabled-active: var(--save-shared-bg);
      --save-enabled-fg: color-mix(in srgb, var(--btn-secondary-fg) 95%, #ffffff);
      --save-disabled-bg: var(--save-shared-bg);
      --save-disabled-fg: color-mix(in srgb, var(--btn-secondary-fg) 40%, var(--bg));
    }
    body.vscode-light {
      --panel-input-bg: color-mix(in srgb, var(--bg) 76%, #d8d8d8);
      --panel-status-bg: color-mix(in srgb, var(--bg) 62%, #e2e2e2);
      --status-log-viewport-bg: color-mix(in srgb, var(--panel-status-bg) 84%, #ffffff);
      --status-log-item-hover-bg: color-mix(in srgb, #000000 3%, transparent);
      --status-title-bg: color-mix(in srgb, var(--panel-status-bg) 70%, #000000);
      --status-title-fg: color-mix(in srgb, var(--text) 92%, #000000);
      --status-title-border: color-mix(in srgb, #000000 10%, #ffffff);
      --status-title-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      --status-idle-fg: color-mix(in srgb, var(--text) 72%, #ffffff);
      --status-starting-fg: #a96a10;
      --status-ready-fg: #1f7a3f;
      --status-connected-fg: #1f7a3f;
      --status-waiting-fg: #a96a10;
      --status-stopped-fg: color-mix(in srgb, var(--text) 88%, #000000);
      --status-error-fg: #b42318;
      --panel-border: color-mix(in srgb, #000000 22%, #ffffff);
      --panel-shadow: 0 1px 2px rgba(0, 0, 0, 0.07);
      --input-bg: color-mix(in srgb, var(--vscode-input-background) 93%, #d9d9d9);
      --input-border: color-mix(in srgb, var(--vscode-input-border, #c8c8c8) 55%, #ffffff);
      --btn-primary-active: color-mix(in srgb, var(--vscode-button-background) 88%, #000000);
      --btn-secondary-bg: color-mix(in srgb, var(--vscode-button-secondaryBackground) 94%, #ffffff);
      --btn-secondary-hover: color-mix(in srgb, var(--vscode-button-secondaryHoverBackground) 96%, #ffffff);
      --btn-secondary-active: color-mix(in srgb, var(--vscode-button-secondaryBackground) 86%, #000000);
      --save-enabled-bg: color-mix(in srgb, var(--btn-secondary-bg) 80%, #000000);
      --save-enabled-hover: color-mix(in srgb, var(--btn-secondary-hover) 74%, #000000);
      --save-shared-bg: #c4c4c4;
      --save-enabled-active: var(--save-shared-bg);
      --save-enabled-fg: color-mix(in srgb, var(--btn-secondary-fg) 92%, #000000);
      --save-disabled-bg: var(--save-shared-bg);
      --save-disabled-fg: color-mix(in srgb, var(--btn-secondary-fg) 44%, #ffffff);
    }
    body {
      margin: 0;
      padding: 8px 0 10px 16px;
      box-sizing: border-box;
      height: 100vh;
      display: flex;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .wrap {
      width: 100%;
      flex: 1 1 auto;
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      padding: 0 16px 0 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .config-block {
      width: 100%;
      max-width: none;
      min-width: 0;
    }
    .config-block > .card,
    .config-block > .status-actions {
      width: 100%;
      max-width: none;
      box-sizing: border-box;
    }
    .card {
      background: transparent;
      border: none;
      padding: 0;
    }
    .card-inner {
      background: var(--panel-input-bg);
      border: 1px solid var(--panel-border);
      box-shadow: var(--panel-shadow);
      border-radius: var(--panel-radius);
      padding: 8px;
    }
    .card-inner.config-panel {
      background: var(--panel-status-bg);
      border: none;
      box-shadow: none;
    }
    .card-inner.input-panel {
      background: transparent;
      border: none;
      box-shadow: none;
      padding: 0;
    }
    .card-inner.status-panel {
      background: transparent;
      border: none;
      box-shadow: none;
      padding: 0;
    }
    .status-inner {
      background: var(--panel-status-bg);
      border-radius: var(--panel-radius);
      padding: 8px;
    }
    .status-actions {
      width: 100%;
      display: flex;
      justify-content: stretch;
      margin-top: 14px;
      margin-bottom: 10px;
      padding: 0 8px;
      box-sizing: border-box;
    }
    .status-card {
      margin-top: 0;
    }
    .bridge-config-card {
      margin-top: 10px;
    }
    .log-card {
      width: 100%;
      margin-top: 10px;
      box-sizing: border-box;
    }
    .status-actions button {
      flex: 1 1 auto;
      width: 100%;
      min-width: 0;
      height: 38px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      padding: 0 10px;
      margin-left: 0;
    }
    .open-editor-button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--btn-primary-bg);
      color: var(--btn-primary-fg);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--btn-primary-bg) 72%, #ffffff 10%);
    }
    .open-editor-button-label {
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
    }
    .open-editor-button-icon {
      position: absolute;
      right: 10px;
      width: 18px;
      height: 18px;
      margin-top: 0;
      flex: none;
      display: block;
      fill: currentColor;
    }
    .open-editor-button:hover {
      background: var(--btn-primary-hover);
    }
    .open-editor-button:active {
      background: var(--btn-primary-active);
    }
    label {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
      display: block;
      margin-bottom: 6px;
    }
    .field-gap {
      height: 12px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      height: 24px;
      border-radius: 4px;
      border: 1px solid var(--input-border);
      padding: 0 8px;
      background: var(--input-bg);
      color: var(--input-fg);
    }
    body.vscode-dark input[type='number'] {
      color-scheme: dark;
    }
    body.vscode-light input[type='number'] {
      color-scheme: light;
    }
    /* 隐藏默认浏览器原生数字微调控件，我们使用自定义微调按钮替代 */
    input[type='number'] {
      -moz-appearance: textfield;
    }
    input[type='number']::-webkit-outer-spin-button,
    input[type='number']::-webkit-inner-spin-button {
      -webkit-appearance: none;
      appearance: none;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      margin: 0 !important;
      width: 0 !important;
      height: 0 !important;
      padding: 0 !important;
      opacity: 0;
    }

    /* 自定义数字输入微调控件样式 */
    .number-input-wrapper {
      position: relative;
      display: inline-block;
      width: 100%;
      box-sizing: border-box;
    }
    .number-input-wrapper input[type='number'] {
      padding-right: 34px;
      box-sizing: border-box;
    }
    .number-spinner {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 1px;
      height: 18px;
      background: transparent;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    }
    .number-spinner button {
      background: transparent;
      border: none;
      padding: 0;
      width: 16px;
      height: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      cursor: pointer;
      line-height: 1;
    }
    .number-spinner button:active { color: var(--text); }
    .number-spinner svg {
      width: 12px;
      height: 7px;
      display: block;
      fill: currentColor;
      transform-origin: center;
      filter: drop-shadow(0 0 0.6px currentColor);
    }
    .number-spinner .spin-up svg {
      transform: rotate(180deg);
    }
    input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 0;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      border-radius: 4px;
      border: 1px solid var(--input-border);
      padding: 6px 8px;
      background: var(--input-bg);
      color: var(--input-fg);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 11px;
      line-height: 1.45;
      resize: vertical;
      min-height: 80px;
    }
    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 0;
    }
    .ai-instructions-card {
      margin-top: 10px;
    }
    .status-log-filter-select {
      height: 24px;
      min-width: 88px;
      border-radius: 4px;
      border: 1px solid var(--input-border);
      padding: 0 6px;
      background: var(--input-bg);
      color: var(--input-fg);
      font-size: 11px;
      box-sizing: border-box;
    }
    .status-log-filter-select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 0;
    }
    .buttons {
      width: 100%;
      display: flex;
      gap: 6px;
      margin-top: 12px;
    }
    .buttons-column {
      flex-direction: column;
    }
    .buttons-divider {
      height: 1px;
      background: color-mix(in srgb, var(--text) 8%, transparent);
      margin: 12px 0 10px 0;
    }
    .buttons button {
      flex: 1 1 0;
      min-width: 0;
      width: 100%;
      white-space: nowrap;
    }
    #startStdioRuntime,
    #stopStdioRuntime {
      height: auto;
      min-height: 26px;
      padding: 4px 10px;
      line-height: 1.2;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
    }
    .bridge-address-box {
      margin-top: 10px;
      padding: 8px;
      background: var(--panel-status-bg);
      border: 1px solid var(--panel-border);
      border-radius: var(--panel-radius);
      box-shadow: var(--panel-shadow);
    }
    .bridge-address-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .bridge-address-header button {
      flex: none;
      width: auto;
      min-width: 52px;
      padding: 0 10px;
    }
    .bridge-address-text {
      display: inline-block;
      max-width: 100%;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text);
      word-break: break-all;
      user-select: text;
      padding: 3px 6px 3px 0;
      background: transparent;
      border-radius: 4px;
      box-sizing: border-box;
    }
    .bridge-address-text.placeholder {
      color: var(--muted);
    }
    button {
      flex: 1;
      height: 22px;
      border: none;
      border-radius: 3px;
      background: var(--btn-primary-bg);
      color: var(--btn-primary-fg);
      font-size: 12px;
      font-weight: 400;
      cursor: pointer;
      transition: background-color .12s ease, color .12s ease;
      padding: 0 8px;
    }
    button:hover { background: var(--btn-primary-hover); }
    button:active {
      background: var(--btn-primary-active);
    }
    button:focus { outline: none; }
    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    button.secondary {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-fg);
    }
    button.secondary.enabled {
      background: var(--btn-secondary-bg);
      color: var(--btn-secondary-fg);
    }
    button.secondary.enabled:hover {
      background: var(--btn-secondary-hover);
    }
    button.secondary.enabled:active {
      background: var(--btn-secondary-active);
    }
    button.secondary:hover {
      background: var(--btn-secondary-hover);
    }
    button.secondary:active {
      background: var(--btn-secondary-active);
    }
    button:disabled {
      cursor: default;
      opacity: 1;
    }
    button.secondary:disabled {
      background: var(--save-disabled-bg);
      color: var(--save-disabled-fg);
    }
    .status {
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      padding-left: 6px;
      color: var(--status-stopped-fg);
      font-weight: 500;
    }
    .status.idle { color: var(--status-idle-fg); }
    .status.starting { color: var(--status-starting-fg); font-weight: 600; }
    .status.ready { color: var(--status-ready-fg); font-weight: 600; }
    .status.running { color: var(--status-ready-fg); font-weight: 600; }
    .status.connected { color: var(--status-connected-fg); font-weight: 600; }
    .status.waiting { color: var(--status-waiting-fg); font-weight: 500; }
    .status.stopped { color: var(--status-stopped-fg); }
    .status.error { color: var(--status-error-fg); font-weight: 600; }
    .status-section + .status-section {
      margin-top: 8px;
    }
    .status-log-box {
      margin-top: 0;
      padding-top: 0;
      border-top: none;
    }
    .status-log-viewport {
      height: 180px;
      margin-top: 8px;
      border: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
      border-radius: 6px;
      background: var(--status-log-viewport-bg);
      overflow: auto;
    }
    .status-log-viewport::-webkit-scrollbar-button {
      width: 0;
      height: 0;
      display: none;
    }
    .status-log-list {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      min-width: 100%;
      width: max-content;
    }
    .status-log-grid-row {
      display: grid;
      min-width: 100%;
      width: max-content;
    }
    .status-log-grid-row.header {
      position: sticky;
      top: 0;
      z-index: 2;
      border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
      background: color-mix(in srgb, var(--status-log-viewport-bg) 84%, var(--panel-status-bg));
    }
    .status-log-grid-row.data {
      border-bottom: 1px solid color-mix(in srgb, var(--text) 6%, transparent);
      cursor: pointer;
      user-select: text;
      transition: background-color .12s ease, color .12s ease;
    }
    .status-log-grid-row.data:hover {
      background: var(--status-log-item-hover-bg);
    }
    .status-log-grid-row.data.selected {
      background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-focusBorder)) 56%, transparent);
    }
    .status-log-grid-row.data.selected .status-log-grid-cell {
      color: var(--vscode-list-activeSelectionForeground, var(--text));
    }
    .status-log-grid-cell {
      padding: 6px 8px;
      font-size: 11px;
      line-height: 1.4;
      white-space: nowrap;
      color: var(--text);
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      box-sizing: border-box;
    }
    .status-log-grid-cell.header {
      font-weight: 600;
      color: var(--muted);
      font-family: var(--vscode-font-family);
    }
    .status-log-empty {
      font-size: 12px;
      color: var(--muted);
      padding-left: 6px;
      margin-top: 2px;
    }
    .status-log-item {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      min-width: 100%;
      width: max-content;
      padding: 0 8px;
      border-bottom: 1px solid color-mix(in srgb, var(--text) 6%, transparent);
      box-sizing: border-box;
      user-select: text;
      transition: background-color .12s ease, color .12s ease;
    }
    .status-log-item:hover {
      background: var(--status-log-item-hover-bg);
    }
    .status-log-item.selected {
      background: color-mix(in srgb, var(--vscode-list-activeSelectionBackground, var(--vscode-focusBorder)) 56%, transparent);
    }
    .status-log-item.selected .status-log-field-label,
    .status-log-item.selected .status-log-field-value,
    .status-log-item.selected .status-log-item-tags,
    .status-log-item.selected .status-log-item-text {
      color: var(--vscode-list-activeSelectionForeground, var(--text));
    }
    .status-log-item:last-child {
      border-bottom: none;
    }
    .status-log-item-text {
      flex: none;
      min-width: 0;
      white-space: pre-wrap;
      font-size: 11px;
      line-height: 1.4;
      color: var(--muted);
    }
    .status-log-item-tags {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: none;
      min-width: 0;
      color: var(--muted);
    }
    .status-log-tag {
      display: inline-flex;
      align-items: center;
      height: 16px;
      padding: 0 5px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text) 8%, transparent);
      color: var(--text);
      font-size: 10px;
      line-height: 1;
      white-space: nowrap;
    }
    .status-log-tag.client {
      max-width: 84px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-log-measure-host {
      position: fixed;
      left: -99999px;
      top: -99999px;
      visibility: hidden;
      pointer-events: none;
      white-space: nowrap;
      z-index: -1;
    }
    .status-log-context-menu {
      position: fixed;
      z-index: 999;
      min-width: 128px;
      padding: 4px;
      border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
      border-radius: 6px;
      background: var(--vscode-menu-background, var(--panel-status-bg));
      box-shadow: 0 8px 20px color-mix(in srgb, #000000 24%, transparent);
      display: none;
    }
    .status-log-context-menu.visible {
      display: block;
    }
    .status-log-context-menu button {
      width: 100%;
      height: 28px;
      display: block;
      text-align: left;
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-menu-foreground, var(--text));
      padding: 0 10px;
    }
    .status-log-context-menu button:hover:not(:disabled),
    .status-log-context-menu button:focus-visible:not(:disabled) {
      background: var(--vscode-menu-selectionBackground, color-mix(in srgb, var(--text) 8%, transparent));
      color: var(--vscode-menu-selectionForeground, var(--text));
      outline: none;
    }
    .status-log-context-menu button:disabled {
      background: transparent;
      color: color-mix(in srgb, var(--vscode-menu-foreground, var(--text)) 42%, transparent);
      cursor: default;
    }
    .status-log-field-switches {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-bottom: 8px;
      padding: 0 2px;
    }
    .status-log-filters {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 2px 8px 2px;
    }
    .status-log-filter-label {
      margin: 0;
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
    }
    .status-log-field-switch {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
    }
    .status-log-field-switch input {
      width: 12px;
      height: 12px;
      margin: 0;
      padding: 0;
    }
    body.vscode-light .wrap .os-theme-dark,
    body.vscode-light .status-log-viewport .os-theme-dark,
    body.vscode-light .connection-list-viewport .os-theme-dark {
      --os-handle-bg: rgba(0, 0, 0, 0.28);
      --os-handle-bg-hover: rgba(0, 0, 0, 0.4);
      --os-handle-bg-active: rgba(0, 0, 0, 0.52);
    }
    body.vscode-dark .wrap .os-theme-light,
    body.vscode-dark .status-log-viewport .os-theme-light,
    body.vscode-dark .connection-list-viewport .os-theme-light {
      --os-handle-bg: rgba(255, 255, 255, 0.28);
      --os-handle-bg-hover: rgba(255, 255, 255, 0.42);
      --os-handle-bg-active: rgba(255, 255, 255, 0.56);
    }
    .wrap .os-scrollbar-button,
    .status-log-viewport .os-scrollbar-button,
    .connection-list-viewport .os-scrollbar-button {
      display: none;
    }
    .hint {
      font-size: 12px;
      color: var(--text);
      font-weight: 600;
    }
    .section-header {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .section-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
    }
    .section-title-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: none;
    }
    .status-log-clear-button {
      flex: none;
      width: auto;
      min-width: 60px;
      height: 20px;
      padding: 0 8px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1;
    }
    .section-description {
      font-size: 12px;
      line-height: 1.45;
      color: var(--muted);
    }
    .status-log-toggle {
      cursor: pointer;
      border-radius: 4px;
      padding: 2px 4px;
      margin: -2px -4px 0 -4px;
    }
    .status-log-toggle:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .status-log-toggle-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      font-size: 11px;
      line-height: 1;
      color: var(--muted);
      transform-origin: center;
      transform: rotateX(0deg);
      backface-visibility: visible;
      transition: transform .12s ease;
    }
    .status-log-toggle-icon svg {
      width: 14px;
      height: 14px;
      display: block;
      fill: currentColor;
    }
    .status-log-toggle.collapsed .status-log-toggle-icon {
      transform: rotateX(180deg);
    }
    .status-log-content.collapsed {
      display: none;
    }
    .status-title {
      display: inline-flex;
      align-items: center;
      background: var(--status-title-bg);
      color: var(--status-title-fg);
      border: none;
      box-shadow: var(--status-title-shadow);
      border-radius: 4px;
      min-height: 18px;
      line-height: 1;
      padding: 0 6px;
      margin-bottom: 3px;
    }
    .status-title.plain {
      color: var(--text);
      background: transparent;
      border: none;
      box-shadow: none;
      min-height: 0;
      padding: 0;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
    }
    .section-divider {
      height: 0;
      border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
      margin: 10px 0 8px 0;
    }
    /* 底部开关行 */
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 8px 6px 8px;
      margin-top: 6px;
      gap: 8px;
    }
    .toggle-label {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
      user-select: none;
      line-height: 1.4;
    }
    .toggle-switch {
      flex: none;
      position: relative;
      width: 36px;
      height: 20px;
      min-width: 36px;
      border-radius: 10px;
      border: none;
      background: color-mix(in srgb, var(--text) 20%, transparent);
      cursor: pointer;
      padding: 0;
      transition: background-color .18s ease;
    }
    .toggle-switch:hover {
      background: color-mix(in srgb, var(--text) 28%, transparent);
    }
    .toggle-switch[aria-checked="true"] {
      background: var(--btn-primary-bg);
    }
    .toggle-switch[aria-checked="true"]:hover {
      background: var(--btn-primary-hover);
    }
    .toggle-switch[aria-checked="true"]:active {
      background: var(--btn-primary-active);
    }
    .toggle-switch:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #ffffff;
      transition: transform .18s ease;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
    }
    .toggle-switch[aria-checked="true"] .toggle-thumb {
      transform: translateX(16px);
    }
  </style>
</head>
<body>
  ${iconsSpriteMarkup}
  <div class="wrap" data-overlayscrollbars-initialize>
    <div class="config-block">
      <div class="card status-card">
        <div class="card-inner status-panel">
          <div class="status-inner">
            <div class="section-header">
              <div class="section-title">运行状态</div>
              <div class="section-description">查看 stdio 运行情况和 EDA 接入状态。</div>
            </div>
            <div class="section-divider"></div>
            <div class="status-section">
              <div class="hint status-title">stdio 状态</div>
              <div id="runtimeStatus" class="status idle">已就绪。</div>
            </div>
            <div class="status-section">
              <div class="hint status-title">EDA 连接</div>
              <div id="bridgeStatus" class="status waiting">桥接客户端未连接。</div>
            </div>
          </div>
        </div>
      </div>
      <div class="status-actions">
        <button id="openEditor" class="open-editor-button">
          <span class="open-editor-button-label">打开嘉立创 EDA</span>
          <svg class="open-editor-button-icon" viewBox="0 0 490 490" focusable="false" aria-hidden="true">
            <use href="#icon-right-arrow"></use>
          </svg>
        </button>
      </div>
      <div class="card bridge-config-card">
        <div class="card-inner config-panel">
          <div id="bridgeConfigToggle" class="section-header status-log-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="bridgeConfigContent">
            <div class="section-title-row">
              <div class="section-title">桥接设置</div>
              <div class="status-log-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <use href="#icon-chevron-down"></use>
                </svg>
              </div>
            </div>
            <div class="section-description">设置桥接监听地址，并将当前桥接地址提供给 EDA 连接器。</div>
          </div>
          <div id="bridgeConfigContent" class="status-log-content">
            <div class="section-divider"></div>
            <label for="host">监听 IP</label>
            <input id="host" type="text" value="127.0.0.1" />
            <div class="field-gap"></div>
            <label for="port">监听端口</label>
            <div class="number-input-wrapper">
              <input id="port" type="number" min="1" max="65535" value="8765" />
              <div class="number-spinner" aria-hidden="true">
                <button type="button" class="spin-up" title="增加端口">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
                </button>
                <button type="button" class="spin-down" title="减少端口">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><use href="#icon-chevron-down"></use></svg>
                </button>
              </div>
            </div>
            <div class="buttons">
              <button id="save" class="secondary" disabled>保存配置</button>
            </div>
            <div class="bridge-address-box">
              <div class="bridge-address-header">
                <div class="hint">桥接地址：</div>
                <button id="copyBridgeAddress" class="secondary">复制</button>
              </div>
              <div id="bridgeAddress" class="bridge-address-text">ws://127.0.0.1:8765/bridge/ws</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card ai-instructions-card">
        <div class="card-inner config-panel">
          <div id="aiInstructionsToggle" class="section-header status-log-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="aiInstructionsContent">
            <div class="section-title-row">
              <div class="section-title">AI 自定义指令</div>
              <div class="status-log-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <use href="#icon-chevron-down"></use>
                </svg>
              </div>
            </div>
            <div class="section-description">自定义 AI 助手指令，留空则仅使用内置指令。保存后重连即生效。</div>
          </div>
          <div id="aiInstructionsContent" class="status-log-content">
            <div class="section-divider"></div>
            <label for="agentInstructions">自定义指令</label>
            <textarea id="agentInstructions" rows="8" placeholder="在此输入自定义指令，留空则仅使用内置系统指令。"></textarea>
            <div class="buttons">
              <button id="saveInstructions" class="secondary" disabled>保存指令</button>
            </div>
          </div>
        </div>
      </div>
      ${buildDebugCardsHtml()}
      <div class="toggle-row">
        <span class="toggle-label">打开 EDA 时关闭侧边栏</span>
        <button id="closeSidebarToggle" class="toggle-switch" role="switch" aria-checked="false" type="button" title="打开 EDA 编辑器时自动关闭侧边栏">
          <span class="toggle-thumb"></span>
        </button>
      </div>
    </div>
  </div>
  <div id="statusLogContextMenu" class="status-log-context-menu" role="menu" aria-label="日志右键菜单">
    <button id="copySelectedLog" type="button" role="menuitem">复制选中日志</button>
    <button id="copyAllLogs" type="button" role="menuitem">复制全部日志</button>
  </div>
  <script nonce="${nonce}" src="${overlayScrollbarsScriptUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const debugSwitch = {
      enableSystemLog: ${DEBUG_SWITCH.enableSystemLog ? 'true' : 'false'},
      enableConnectionList: ${DEBUG_SWITCH.enableConnectionList ? 'true' : 'false'}
    };
    const hostInput = document.getElementById('host');
    const portInput = document.getElementById('port');
    const saveButton = document.getElementById('save');
    const spinUpButton = document.querySelector('.number-spinner .spin-up');
    const spinDownButton = document.querySelector('.number-spinner .spin-down');
    const pageScrollElement = document.querySelector('.wrap');
    const copyBridgeAddressButton = document.getElementById('copyBridgeAddress');
    const openEditorButton = document.getElementById('openEditor');
    const startStdioRuntimeButton = document.getElementById('startStdioRuntime');
    const stopStdioRuntimeButton = document.getElementById('stopStdioRuntime');
    const bridgeAddressElement = document.getElementById('bridgeAddress');
    const runtimeStatusElement = document.getElementById('runtimeStatus');
    const bridgeStatusElement = document.getElementById('bridgeStatus');
    const bridgeConfigToggleElement = document.getElementById('bridgeConfigToggle');
    const bridgeConfigContentElement = document.getElementById('bridgeConfigContent');
    const statusLogToggleElement = document.getElementById('statusLogToggle');
    const statusLogContentElement = document.getElementById('statusLogContent');
    const statusLogLevelFilterElement = document.getElementById('statusLogLevelFilter');
    const statusLogSourceFilterElement = document.getElementById('statusLogSourceFilter');
    const statusLogFieldSwitchesElement = document.getElementById('statusLogFieldSwitches');
    const connectionListToggleElement = document.getElementById('connectionListToggle');
    const connectionListContentElement = document.getElementById('connectionListContent');
    const statusLogViewportElement = document.getElementById('statusLogViewport');
    const statusLogListElement = document.getElementById('statusLogList');
    const statusLogEmptyElement = document.getElementById('statusLogEmpty');
    const connectionListViewportElement = document.getElementById('connectionListViewport');
    const connectionListElement = document.getElementById('connectionList');
    const connectionListEmptyElement = document.getElementById('connectionListEmpty');
    const statusLogContextMenuElement = document.getElementById('statusLogContextMenu');
    const copySelectedLogButton = document.getElementById('copySelectedLog');
    const copyAllLogsButton = document.getElementById('copyAllLogs');
    const clearStatusLogsButton = document.getElementById('clearStatusLogs');
    const aiInstructionsToggleElement = document.getElementById('aiInstructionsToggle');
    const aiInstructionsContentElement = document.getElementById('aiInstructionsContent');
    const agentInstructionsTextarea = document.getElementById('agentInstructions');
    const saveInstructionsButton = document.getElementById('saveInstructions');

    let savedConfig = null;
    let previousSavedConfig = null;
    let isSaving = false;
    let pageScrollbar = null;
    let statusLogScrollbar = null;
    let connectionListScrollbar = null;
    let selectedStatusLogIndex = -1;
    let statusLogEntries = [];
    let filteredStatusLogEntries = [];
    let connectedClients = [];
    let isBridgeConfigCollapsed = false;
    let isStatusLogCollapsed = false;
    let isConnectionListCollapsed = false;
    let savedInstructions = '';
    let isAiInstructionsCollapsed = false;
    let copyBridgeAddressButtonResetTimer = null;
    let statusLogScrollFrameId = 0;
    let logFieldSchema = {
      fieldOrder: [],
      fieldLabels: {},
      defaultVisibleFields: []
    };
    let visibleStatusLogFields = new Set();
    let hasInitializedVisibleStatusLogFields = false;
    let statusLogMeasureHost = null;
    const statusLogMeasureCache = new Map();
    let statusLogLevelFilter = 'all';
    let statusLogSourceFilter = 'all';
    let preserveStatusLogTableOnClear = false;

    const STATUS_LOG_LEVEL_FILTER_VALUES = new Set(['all', 'info', 'success', 'warning', 'error']);
    const STATUS_LOG_SOURCE_FILTER_VALUES = new Set(['all', 'server', 'client']);

    function normalizeStatusLogLevelFilterValue(value) {
      const normalizedValue = String(value || 'all').trim();
      return STATUS_LOG_LEVEL_FILTER_VALUES.has(normalizedValue) ? normalizedValue : 'all';
    }

    function normalizeStatusLogSourceFilterValue(value) {
      const normalizedValue = String(value || 'all').trim();
      return STATUS_LOG_SOURCE_FILTER_VALUES.has(normalizedValue) ? normalizedValue : 'all';
    }

    function normalizePersistedStringArray(value) {
      if (!Array.isArray(value)) {
        return [];
      }

      const deduped = [];
      value.forEach((item) => {
        const text = String(item || '').trim();
        if (text.length > 0 && !deduped.includes(text)) {
          deduped.push(text);
        }
      });
      return deduped;
    }

    function readPersistedStatusLogOptions() {
      const rawState = typeof vscode.getState === 'function' ? vscode.getState() : null;
      const options = rawState && typeof rawState === 'object' ? rawState : null;
      if (!options) {
        return null;
      }

      const visibleFields = normalizePersistedStringArray(options.visibleStatusLogFields);
      const hasInitialized = options.hasInitializedVisibleStatusLogFields === true || visibleFields.length > 0;
      return {
        statusLogLevelFilter: normalizeStatusLogLevelFilterValue(options.statusLogLevelFilter),
        statusLogSourceFilter: normalizeStatusLogSourceFilterValue(options.statusLogSourceFilter),
        visibleStatusLogFields: visibleFields,
        hasInitializedVisibleStatusLogFields: hasInitialized,
      };
    }

    function persistStatusLogOptions() {
      if (typeof vscode.setState !== 'function') {
        return;
      }

      vscode.setState({
        statusLogLevelFilter,
        statusLogSourceFilter,
        visibleStatusLogFields: Array.from(visibleStatusLogFields),
        hasInitializedVisibleStatusLogFields,
      });
    }

    const persistedStatusLogOptions = readPersistedStatusLogOptions();
    if (persistedStatusLogOptions) {
      statusLogLevelFilter = persistedStatusLogOptions.statusLogLevelFilter;
      statusLogSourceFilter = persistedStatusLogOptions.statusLogSourceFilter;
      visibleStatusLogFields = new Set(persistedStatusLogOptions.visibleStatusLogFields);
      hasInitializedVisibleStatusLogFields = persistedStatusLogOptions.hasInitializedVisibleStatusLogFields;
    }

    function getOrderedLogFieldKeys(fields) {
      const keysInSchema = Array.isArray(logFieldSchema.fieldOrder)
        ? logFieldSchema.fieldOrder.filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
        : [];
      const remainingKeys = Object.keys(fields).filter((key) => !keysInSchema.includes(key));
      return keysInSchema.concat(remainingKeys);
    }

    function getLogFieldLabel(fieldKey) {
      if (logFieldSchema && logFieldSchema.fieldLabels && typeof logFieldSchema.fieldLabels[fieldKey] === 'string') {
        return logFieldSchema.fieldLabels[fieldKey];
      }

      return fieldKey;
    }

    function ensureVisibleStatusLogFields(fields) {
      if (!(visibleStatusLogFields instanceof Set)) {
        visibleStatusLogFields = new Set();
        hasInitializedVisibleStatusLogFields = false;
      }

      if (hasInitializedVisibleStatusLogFields) {
        return;
      }

      const defaultVisibleFields = Array.isArray(logFieldSchema.defaultVisibleFields)
        ? logFieldSchema.defaultVisibleFields
        : [];
      const orderedKeys = getOrderedLogFieldKeys(fields);
      const initialVisibleKeys = defaultVisibleFields.length > 0 ? defaultVisibleFields : orderedKeys;
      initialVisibleKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          visibleStatusLogFields.add(key);
        }
      });

      hasInitializedVisibleStatusLogFields = true;
      persistStatusLogOptions();
    }

    function getVisibleLogFieldKeys(fields) {
      const orderedKeys = getOrderedLogFieldKeys(fields);
      return orderedKeys.filter((key) => visibleStatusLogFields.has(key));
    }

    function collectStatusLogFields(entries) {
      const fields = {};
      entries.forEach((entry) => {
        if (!entry || !entry.fields || typeof entry.fields !== 'object') {
          return;
        }

        Object.keys(entry.fields).forEach((fieldKey) => {
          fields[fieldKey] = entry.fields[fieldKey];
        });
      });
      return fields;
    }

    function normalizeStatusLogSource(entry) {
      const entryFields = entry && entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
      const sourceText = String(entryFields.source || '').trim().toLowerCase();
      if (sourceText === 'server' || sourceText === '服务端') {
        return 'server';
      }

      if (sourceText === 'connector' || sourceText === 'client' || sourceText === '客户端') {
        return 'client';
      }

      return '';
    }

    function getFilteredStatusLogEntries(entries) {
      if (!Array.isArray(entries) || entries.length === 0) {
        return [];
      }

      return entries.filter((entry) => {
        const entryLevel = String(entry && entry.level ? entry.level : '').trim();
        if (statusLogLevelFilter !== 'all' && entryLevel !== statusLogLevelFilter) {
          return false;
        }

        if (statusLogSourceFilter !== 'all') {
          const entrySource = normalizeStatusLogSource(entry);
          if (entrySource !== statusLogSourceFilter) {
            return false;
          }
        }

        return true;
      });
    }

    function ensureStatusLogMeasureHost() {
      if (statusLogMeasureHost instanceof HTMLElement) {
        return statusLogMeasureHost;
      }

      const host = document.createElement('div');
      host.className = 'status-log-measure-host';
      document.body.appendChild(host);
      statusLogMeasureHost = host;
      return host;
    }

    function measureStatusLogCellWidth(text, isHeader) {
      const normalizedText = String(text || '').trim();
      const cacheKey = (isHeader ? 'H|' : 'D|') + normalizedText;
      if (statusLogMeasureCache.has(cacheKey)) {
        return statusLogMeasureCache.get(cacheKey);
      }

      const measureHost = ensureStatusLogMeasureHost();
      const cell = document.createElement('div');
      cell.className = isHeader ? 'status-log-grid-cell header' : 'status-log-grid-cell';
      cell.textContent = normalizedText.length > 0 ? normalizedText : ' ';
      measureHost.appendChild(cell);

      const width = Math.ceil(cell.getBoundingClientRect().width) + 6;
      measureHost.removeChild(cell);

      const finalWidth = Math.max(44, width);
      statusLogMeasureCache.set(cacheKey, finalWidth);
      return finalWidth;
    }

    function buildStatusLogColumnTemplate(entries, visibleKeys) {
      if (!Array.isArray(visibleKeys) || visibleKeys.length === 0) {
        return '';
      }

      const columns = visibleKeys.map((fieldKey) => {
        const headerLabel = getLogFieldLabel(fieldKey);
        let maxWidth = measureStatusLogCellWidth(headerLabel, true);

        entries.forEach((entry) => {
          const entryFields = entry && entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
          const value = String(entryFields[fieldKey] || '').trim();
          const contentText = value.length > 0 ? value : headerLabel;
          const contentWidth = measureStatusLogCellWidth(contentText, false);
          if (contentWidth > maxWidth) {
            maxWidth = contentWidth;
          }
        });

        return String(maxWidth) + 'px';
      });

      return columns.join(' ');
    }

    function formatStatusLogEntry(entry) {
      const fields = entry && entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
      ensureVisibleStatusLogFields(fields);
      const visibleKeys = getVisibleLogFieldKeys(fields);
      if (visibleKeys.length === 0) {
        return '';
      }

      return visibleKeys
        .map((fieldKey) => getLogFieldLabel(fieldKey) + ': ' + String(fields[fieldKey] || ''))
        .join('\\n');
    }

    function getSelectedStatusLogText() {
      if (selectedStatusLogIndex < 0 || selectedStatusLogIndex >= filteredStatusLogEntries.length) {
        return '';
      }

      return formatStatusLogEntry(filteredStatusLogEntries[selectedStatusLogIndex]);
    }

    function getAllStatusLogText() {
      return statusLogEntries.map((entry) => formatStatusLogEntry(entry)).filter((text) => text.length > 0).join('\\n\\n');
    }

    function renderStatusLogFieldSwitches() {
      if (!debugSwitch.enableSystemLog || !statusLogFieldSwitchesElement) {
        return;
      }

      statusLogFieldSwitchesElement.textContent = '';
      if (!Array.isArray(statusLogEntries) || statusLogEntries.length === 0) {
        return;
      }

      const fields = collectStatusLogFields(statusLogEntries);
      const orderedKeys = getOrderedLogFieldKeys(fields);
      ensureVisibleStatusLogFields(fields);

      const fragment = document.createDocumentFragment();
      orderedKeys.forEach((fieldKey) => {
        const label = document.createElement('label');
        label.className = 'status-log-field-switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = visibleStatusLogFields.has(fieldKey);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            visibleStatusLogFields.add(fieldKey);
          }
          else {
            visibleStatusLogFields.delete(fieldKey);
          }
          hasInitializedVisibleStatusLogFields = true;
          persistStatusLogOptions();
          renderStatusLogs(statusLogEntries);
        });

        const text = document.createElement('span');
        text.textContent = getLogFieldLabel(fieldKey);

        label.appendChild(checkbox);
        label.appendChild(text);
        fragment.appendChild(label);
      });

      statusLogFieldSwitchesElement.appendChild(fragment);
    }

    function hideStatusLogContextMenu() {
      if (!statusLogContextMenuElement) {
        return;
      }

      statusLogContextMenuElement.classList.remove('visible');
      statusLogContextMenuElement.style.left = '-9999px';
      statusLogContextMenuElement.style.top = '-9999px';
    }

    function showStatusLogContextMenu(clientX, clientY) {
      if (!statusLogContextMenuElement || !copySelectedLogButton || !copyAllLogsButton) {
        return;
      }

      copySelectedLogButton.disabled = getSelectedStatusLogText().length === 0;
      copyAllLogsButton.disabled = statusLogEntries.length === 0;
      statusLogContextMenuElement.classList.add('visible');

      const menuRect = statusLogContextMenuElement.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
      const nextLeft = Math.min(clientX, maxLeft);
      const nextTop = Math.min(clientY, maxTop);
      statusLogContextMenuElement.style.left = nextLeft + 'px';
      statusLogContextMenuElement.style.top = nextTop + 'px';
    }

    function setSelectedStatusLogIndex(nextIndex) {
      selectedStatusLogIndex = Number.isInteger(nextIndex) ? nextIndex : -1;
      if (!statusLogListElement) {
        return;
      }

      const rows = statusLogListElement.querySelectorAll('.status-log-grid-row.data');
      rows.forEach((row, index) => {
        row.classList.toggle('selected', index === selectedStatusLogIndex);
      });
    }

    function getStatusLogScrollbarTheme() {
      return document.body.classList.contains('vscode-light') ? 'os-theme-dark' : 'os-theme-light';
    }

    function ensurePageScrollbar() {
      const overlayApi = window.OverlayScrollbarsGlobal && window.OverlayScrollbarsGlobal.OverlayScrollbars;
      if (!overlayApi || !(pageScrollElement instanceof HTMLElement)) {
        return null;
      }

      if (!pageScrollbar) {
        pageScrollbar = overlayApi(pageScrollElement, {
          scrollbars: {
            theme: getStatusLogScrollbarTheme(),
            autoHide: 'leave',
            autoHideSuspend: false
          },
          overflow: {
            x: 'hidden'
          }
        });
        return pageScrollbar;
      }

      pageScrollbar.options({
        scrollbars: {
          theme: getStatusLogScrollbarTheme(),
          autoHide: 'leave',
          autoHideSuspend: false
        },
        overflow: {
          x: 'hidden'
        }
      });
      return pageScrollbar;
    }

    function ensureStatusLogScrollbar() {
      const overlayApi = window.OverlayScrollbarsGlobal && window.OverlayScrollbarsGlobal.OverlayScrollbars;
      if (!overlayApi || !statusLogViewportElement) {
        return null;
      }

      if (!statusLogScrollbar) {
        statusLogScrollbar = overlayApi(statusLogViewportElement, {
          scrollbars: {
            theme: getStatusLogScrollbarTheme(),
            autoHide: 'leave',
            autoHideSuspend: false
          }
        });
        return statusLogScrollbar;
      }

      statusLogScrollbar.options({
        scrollbars: {
          theme: getStatusLogScrollbarTheme(),
          autoHide: 'leave',
          autoHideSuspend: false
        }
      });
      return statusLogScrollbar;
    }

    function ensureConnectionListScrollbar() {
      const overlayApi = window.OverlayScrollbarsGlobal && window.OverlayScrollbarsGlobal.OverlayScrollbars;
      if (!overlayApi || !connectionListViewportElement) {
        return null;
      }

      if (!connectionListScrollbar) {
        connectionListScrollbar = overlayApi(connectionListViewportElement, {
          scrollbars: {
            theme: getStatusLogScrollbarTheme(),
            autoHide: 'leave',
            autoHideSuspend: false
          }
        });
        return connectionListScrollbar;
      }

      connectionListScrollbar.options({
        scrollbars: {
          theme: getStatusLogScrollbarTheme(),
          autoHide: 'leave',
          autoHideSuspend: false
        }
      });
      return connectionListScrollbar;
    }

    // 切换桥接设置区域的折叠状态。
    function setBridgeConfigCollapsed(collapsed) {
      isBridgeConfigCollapsed = Boolean(collapsed);
      if (!bridgeConfigToggleElement || !bridgeConfigContentElement) {
        return;
      }

      bridgeConfigToggleElement.classList.toggle('collapsed', isBridgeConfigCollapsed);
      bridgeConfigContentElement.classList.toggle('collapsed', isBridgeConfigCollapsed);
      bridgeConfigToggleElement.setAttribute('aria-expanded', String(!isBridgeConfigCollapsed));
    }

    // 切换连接日志区域的折叠状态。
    function setStatusLogCollapsed(collapsed) {
      isStatusLogCollapsed = Boolean(collapsed);
      if (!statusLogToggleElement || !statusLogContentElement) {
        return;
      }

      statusLogToggleElement.classList.toggle('collapsed', isStatusLogCollapsed);
      statusLogContentElement.classList.toggle('collapsed', isStatusLogCollapsed);
      statusLogToggleElement.setAttribute('aria-expanded', String(!isStatusLogCollapsed));

      if (isStatusLogCollapsed) {
        hideStatusLogContextMenu();
        return;
      }

      const scrollbar = ensureStatusLogScrollbar();
      if (scrollbar) {
        scrollbar.update(true);
      }
    }

    // 切换连接列表区域的折叠状态。
    function setConnectionListCollapsed(collapsed) {
      isConnectionListCollapsed = Boolean(collapsed);
      if (!connectionListToggleElement || !connectionListContentElement) {
        return;
      }

      connectionListToggleElement.classList.toggle('collapsed', isConnectionListCollapsed);
      connectionListContentElement.classList.toggle('collapsed', isConnectionListCollapsed);
      connectionListToggleElement.setAttribute('aria-expanded', String(!isConnectionListCollapsed));

      if (isConnectionListCollapsed) {
        return;
      }

      const scrollbar = ensureConnectionListScrollbar();
      if (scrollbar) {
        scrollbar.update(true);
      }
    }

    // 切换 AI 指令设置区域的折叠状态。
    function setAiInstructionsCollapsed(collapsed) {
      isAiInstructionsCollapsed = Boolean(collapsed);
      if (!aiInstructionsToggleElement || !aiInstructionsContentElement) {
        return;
      }

      aiInstructionsToggleElement.classList.toggle('collapsed', isAiInstructionsCollapsed);
      aiInstructionsContentElement.classList.toggle('collapsed', isAiInstructionsCollapsed);
      aiInstructionsToggleElement.setAttribute('aria-expanded', String(!isAiInstructionsCollapsed));
    }

    function isInstructionsChanged() {
      if (!agentInstructionsTextarea) {
        return false;
      }
      return agentInstructionsTextarea.value !== savedInstructions;
    }

    function refreshInstructionsSaveButton() {
      if (!saveInstructionsButton) {
        return;
      }
      const changed = isInstructionsChanged();
      saveInstructionsButton.disabled = !changed;
      saveInstructionsButton.classList.toggle('enabled', changed);
    }

    function scheduleScrollStatusLogsToBottom() {
      if (!debugSwitch.enableSystemLog || isStatusLogCollapsed) {
        return;
      }

      if (statusLogScrollFrameId !== 0) {
        cancelAnimationFrame(statusLogScrollFrameId);
      }

      statusLogScrollFrameId = requestAnimationFrame(() => {
        statusLogScrollFrameId = 0;
        scrollStatusLogsToBottom();
      });
    }

    function scrollStatusLogsToBottom() {
      if (!debugSwitch.enableSystemLog || isStatusLogCollapsed) {
        return;
      }

      const scrollbar = ensureStatusLogScrollbar();
      if (scrollbar) {
        scrollbar.update(true);
        const viewport = scrollbar.elements().viewport;
        viewport.scrollTop = viewport.scrollHeight;
        return;
      }

      if (statusLogViewportElement) {
        statusLogViewportElement.scrollTop = statusLogViewportElement.scrollHeight;
      }
    }

    function clearStatusLogDataRowsOnly() {
      if (!statusLogListElement) {
        return;
      }

      const dataRows = statusLogListElement.querySelectorAll('.status-log-grid-row.data');
      dataRows.forEach((row) => {
        row.remove();
      });
    }

    function renderStatusLogs(entries) {
      if (!debugSwitch.enableSystemLog || !statusLogListElement || !statusLogEmptyElement) {
        return;
      }

      const previousLogCount = filteredStatusLogEntries.length;
      const hasHeaderRow = Boolean(statusLogListElement.querySelector('.status-log-grid-row.header'));
      statusLogEntries = Array.isArray(entries) ? entries.slice() : [];
      filteredStatusLogEntries = getFilteredStatusLogEntries(statusLogEntries);
      if (filteredStatusLogEntries.length === 0) {
        selectedStatusLogIndex = -1;

        if (preserveStatusLogTableOnClear) {
          statusLogEmptyElement.style.display = 'none';
          statusLogEmptyElement.textContent = '';
          if (hasHeaderRow) {
            clearStatusLogDataRowsOnly();
          }
          preserveStatusLogTableOnClear = false;
          hideStatusLogContextMenu();
          if (statusLogScrollbar) {
            statusLogScrollbar.update(true);
          }
          return;
        }

        preserveStatusLogTableOnClear = false;
        statusLogEmptyElement.style.display = 'none';
        statusLogEmptyElement.textContent = '';
        if (statusLogEntries.length > 0) {
          renderStatusLogFieldSwitches();
        }
        hideStatusLogContextMenu();
        if (statusLogScrollbar) {
          statusLogScrollbar.update(true);
        }
        return;
      }

      if (selectedStatusLogIndex >= filteredStatusLogEntries.length) {
        selectedStatusLogIndex = -1;
      }

      statusLogListElement.textContent = '';

      const fields = collectStatusLogFields(filteredStatusLogEntries);
      ensureVisibleStatusLogFields(fields);
      const visibleKeys = getVisibleLogFieldKeys(fields);
      renderStatusLogFieldSwitches();

      if (visibleKeys.length === 0) {
        statusLogEmptyElement.textContent = '';
        statusLogEmptyElement.style.display = 'none';
        hideStatusLogContextMenu();
        if (statusLogScrollbar) {
          statusLogScrollbar.update(true);
        }
        return;
      }

      preserveStatusLogTableOnClear = false;
      statusLogEmptyElement.textContent = '';
      statusLogEmptyElement.style.display = 'none';

      const columnTemplate = buildStatusLogColumnTemplate(filteredStatusLogEntries, visibleKeys);
      const fragment = document.createDocumentFragment();

      const headerRow = document.createElement('div');
      headerRow.className = 'status-log-grid-row header';
      headerRow.style.gridTemplateColumns = columnTemplate;
      visibleKeys.forEach((fieldKey) => {
        const headerCell = document.createElement('div');
        headerCell.className = 'status-log-grid-cell header';
        const headerText = getLogFieldLabel(fieldKey);
        headerCell.textContent = headerText;
        headerCell.title = headerText;
        headerRow.appendChild(headerCell);
      });
      fragment.appendChild(headerRow);

      filteredStatusLogEntries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'status-log-grid-row data ' + String(entry.level || 'info');
        row.dataset.index = String(index);
        row.style.gridTemplateColumns = columnTemplate;
        row.addEventListener('click', () => {
          setSelectedStatusLogIndex(index);
        });
        row.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          setSelectedStatusLogIndex(index);
          showStatusLogContextMenu(event.clientX, event.clientY);
        });

        const entryFields = entry && entry.fields && typeof entry.fields === 'object' ? entry.fields : {};
        visibleKeys.forEach((fieldKey) => {
          const value = String(entryFields[fieldKey] || '').trim();
          const cell = document.createElement('div');
          cell.className = 'status-log-grid-cell';
          cell.textContent = value;
          cell.title = value;
          row.appendChild(cell);
        });

        fragment.appendChild(row);
      });

      statusLogListElement.appendChild(fragment);
      setSelectedStatusLogIndex(selectedStatusLogIndex);
      if (filteredStatusLogEntries.length >= previousLogCount) {
        scheduleScrollStatusLogsToBottom();
      }
    }

    // 渲染当前活跃 WebSocket 客户端列表。
    function renderConnectedClients(entries) {
      if (!debugSwitch.enableConnectionList || !connectionListElement || !connectionListEmptyElement) {
        return;
      }

      connectedClients = Array.isArray(entries) ? entries.slice() : [];
      connectionListElement.textContent = '';
      if (connectedClients.length === 0) {
        connectionListEmptyElement.style.display = 'none';
        connectionListEmptyElement.textContent = '';
        if (connectionListScrollbar) {
          connectionListScrollbar.update(true);
        }
        return;
      }

      connectionListEmptyElement.style.display = 'none';
      connectionListEmptyElement.textContent = '';
      const fragment = document.createDocumentFragment();
      connectedClients.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'status-log-item connection-item info';

        const tags = document.createElement('span');
        tags.className = 'status-log-item-tags';

        const roleTag = document.createElement('span');
        roleTag.className = 'status-log-tag runtime';
        roleTag.textContent = entry && entry.role === 'active' ? '活动' : '待命';
        tags.appendChild(roleTag);

        const text = document.createElement('span');
        text.className = 'status-log-item-text';
        text.textContent = String(entry && entry.clientId ? entry.clientId : '');
        text.title = text.textContent;

        row.appendChild(tags);
        row.appendChild(text);
        fragment.appendChild(row);
      });

      connectionListElement.appendChild(fragment);
      const scrollbar = ensureConnectionListScrollbar();
      if (scrollbar) {
        scrollbar.update(true);
      }
    }

    function getConfig() {
      return {
        host: String(hostInput.value || '').trim(),
        port: Number.parseInt(String(portInput.value || '0'), 10)
      };
    }

    // 根据当前输入生成桥接地址预览。
    function getBridgeAddressPreview() {
      const config = getConfig();
      if (config.host.length === 0 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
        return '';
      }

      return 'ws://' + config.host + ':' + config.port + '/bridge/ws';
    }

    // 刷新保存按钮和桥接地址预览区域。
    function refreshBridgeAddressPreview() {
      const bridgeAddress = getBridgeAddressPreview();
      const hasBridgeAddress = bridgeAddress.length > 0;

      bridgeAddressElement.textContent = hasBridgeAddress
        ? bridgeAddress
        : '请先输入有效的监听地址。';
      bridgeAddressElement.classList.toggle('placeholder', !hasBridgeAddress);
      copyBridgeAddressButton.disabled = !hasBridgeAddress;
    }

    // 复制成功后短暂反馈按钮状态。
    function showCopyBridgeAddressDoneState() {
      if (copyBridgeAddressButtonResetTimer !== null) {
        clearTimeout(copyBridgeAddressButtonResetTimer);
      }

      copyBridgeAddressButton.textContent = '已复制';
      copyBridgeAddressButtonResetTimer = setTimeout(() => {
        copyBridgeAddressButton.textContent = '复制';
        copyBridgeAddressButtonResetTimer = null;
      }, 1500);
    }

    function isConfigChanged() {
      if (!savedConfig) {
        return false;
      }
      const current = getConfig();
      return current.host !== savedConfig.host || current.port !== savedConfig.port;
    }

    function refreshSaveButton() {
      const changed = isConfigChanged();
      saveButton.disabled = !changed;
      saveButton.classList.toggle('enabled', changed);
      refreshBridgeAddressPreview();
    }

    saveButton.addEventListener('click', () => {
      if (saveButton.disabled) {
        return;
      }
      const configToSave = getConfig();
      previousSavedConfig = savedConfig ? {
        host: savedConfig.host,
        port: savedConfig.port
      } : null;
      isSaving = true;
      savedConfig = {
        host: configToSave.host,
        port: configToSave.port
      };
      refreshSaveButton();
      vscode.postMessage({ command: 'save', payload: configToSave });
    });

    if (agentInstructionsTextarea) {
      agentInstructionsTextarea.addEventListener('input', () => {
        refreshInstructionsSaveButton();
      });
    }

    if (saveInstructionsButton) {
      saveInstructionsButton.addEventListener('click', () => {
        if (saveInstructionsButton.disabled) {
          return;
        }
        const instructionsToSave = agentInstructionsTextarea ? agentInstructionsTextarea.value : '';
        savedInstructions = instructionsToSave;
        refreshInstructionsSaveButton();
        vscode.postMessage({ command: 'saveInstructions', payload: instructionsToSave });
      });
    }

    if (aiInstructionsToggleElement) {
      aiInstructionsToggleElement.addEventListener('click', () => {
        setAiInstructionsCollapsed(!isAiInstructionsCollapsed);
      });
      aiInstructionsToggleElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setAiInstructionsCollapsed(!isAiInstructionsCollapsed);
        }
      });
    }

    copyBridgeAddressButton.addEventListener('click', () => {
      if (copyBridgeAddressButton.disabled) {
        return;
      }

      const bridgeAddress = getBridgeAddressPreview();
      if (bridgeAddress.length === 0) {
        return;
      }

      vscode.postMessage({ command: 'copyBridgeAddress', payload: bridgeAddress });
      showCopyBridgeAddressDoneState();
    });

    // 自定义微调按钮行为：增/减端口值
    if (spinUpButton && portInput) {
      spinUpButton.addEventListener('click', (ev) => {
        ev.preventDefault();
        const input = /** @type {HTMLInputElement} */ (portInput);
        if (!input) return;
        const cur = Number.parseInt(String(input.value || '0'), 10) || 0;
        const max = Number.parseInt(String(input.max || '65535'), 10) || 65535;
        if (cur < max) {
          input.value = String(cur + 1);
          refreshSaveButton();
        }
      });
    }
    if (spinDownButton && portInput) {
      spinDownButton.addEventListener('click', (ev) => {
        ev.preventDefault();
        const input = /** @type {HTMLInputElement} */ (portInput);
        if (!input) return;
        const cur = Number.parseInt(String(input.value || '0'), 10) || 0;
        const min = Number.parseInt(String(input.min || '1'), 10) || 1;
        if (cur > min) {
          input.value = String(cur - 1);
          refreshSaveButton();
        }
      });
    }

    if (copySelectedLogButton) {
      copySelectedLogButton.addEventListener('click', () => {
        const selectedLogText = getSelectedStatusLogText();
        if (selectedLogText.length === 0) {
          return;
        }

        hideStatusLogContextMenu();
        vscode.postMessage({ command: 'copySelectedLog', payload: selectedLogText });
      });
    }

    if (copyAllLogsButton) {
      copyAllLogsButton.addEventListener('click', () => {
        const allLogText = getAllStatusLogText();
        if (allLogText.length === 0) {
          return;
        }

        hideStatusLogContextMenu();
        vscode.postMessage({ command: 'copyAllLogs', payload: allLogText });
      });
    }

    if (clearStatusLogsButton) {
      clearStatusLogsButton.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      clearStatusLogsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        preserveStatusLogTableOnClear = true;
        selectedStatusLogIndex = -1;
        statusLogEntries = [];
        filteredStatusLogEntries = [];
        clearStatusLogDataRowsOnly();
        hideStatusLogContextMenu();
        if (statusLogScrollbar) {
          statusLogScrollbar.update(true);
        }
        vscode.postMessage({ command: 'clearLogs' });
      });
      clearStatusLogsButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      });
    }

    openEditorButton.addEventListener('click', () => {
      vscode.postMessage({ command: 'openEditor' });
    });

    if (startStdioRuntimeButton) {
      startStdioRuntimeButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'startStdioRuntime' });
      });
    }

    if (stopStdioRuntimeButton) {
      stopStdioRuntimeButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'stopStdioRuntime' });
      });
    }

    if (bridgeConfigToggleElement) {
      bridgeConfigToggleElement.addEventListener('click', () => {
        setBridgeConfigCollapsed(!isBridgeConfigCollapsed);
      });
      bridgeConfigToggleElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setBridgeConfigCollapsed(!isBridgeConfigCollapsed);
        }
      });
    }

    if (statusLogToggleElement) {
      statusLogToggleElement.addEventListener('click', () => {
        setStatusLogCollapsed(!isStatusLogCollapsed);
      });
      statusLogToggleElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setStatusLogCollapsed(!isStatusLogCollapsed);
        }
      });
    }

    if (connectionListToggleElement) {
      connectionListToggleElement.addEventListener('click', () => {
        setConnectionListCollapsed(!isConnectionListCollapsed);
      });
      connectionListToggleElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setConnectionListCollapsed(!isConnectionListCollapsed);
        }
      });
    }

    if (statusLogLevelFilterElement instanceof HTMLSelectElement) {
      statusLogLevelFilterElement.value = statusLogLevelFilter;
      statusLogLevelFilter = normalizeStatusLogLevelFilterValue(statusLogLevelFilterElement.value);
      statusLogLevelFilterElement.addEventListener('change', () => {
        statusLogLevelFilter = normalizeStatusLogLevelFilterValue(statusLogLevelFilterElement.value);
        persistStatusLogOptions();
        renderStatusLogs(statusLogEntries);
      });
    }

    if (statusLogSourceFilterElement instanceof HTMLSelectElement) {
      statusLogSourceFilterElement.value = statusLogSourceFilter;
      statusLogSourceFilter = normalizeStatusLogSourceFilterValue(statusLogSourceFilterElement.value);
      statusLogSourceFilterElement.addEventListener('change', () => {
        statusLogSourceFilter = normalizeStatusLogSourceFilterValue(statusLogSourceFilterElement.value);
        persistStatusLogOptions();
        renderStatusLogs(statusLogEntries);
      });
    }

    if (statusLogViewportElement) {
      statusLogViewportElement.addEventListener('contextmenu', (event) => {
        const rowElement = event.target instanceof Element ? event.target.closest('.status-log-grid-row.data') : null;
        if (!rowElement && statusLogEntries.length === 0) {
          return;
        }

        event.preventDefault();
        if (rowElement) {
          const nextIndex = Number.parseInt(String(rowElement.dataset.index || '-1'), 10);
          setSelectedStatusLogIndex(Number.isInteger(nextIndex) ? nextIndex : -1);
        }
        showStatusLogContextMenu(event.clientX, event.clientY);
      });
    }

    document.addEventListener('click', (event) => {
      if (!statusLogContextMenuElement) {
        return;
      }

      if (event.target instanceof Node && statusLogContextMenuElement.contains(event.target)) {
        return;
      }

      hideStatusLogContextMenu();
    });

    window.addEventListener('blur', () => {
      hideStatusLogContextMenu();
    });

    window.addEventListener('resize', () => {
      hideStatusLogContextMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideStatusLogContextMenu();
      }
    });

    hostInput.addEventListener('input', () => {
      refreshSaveButton();
    });

    portInput.addEventListener('input', () => {
      refreshSaveButton();
    });

    if (statusLogViewportElement) {
      statusLogViewportElement.addEventListener('scroll', () => {
        hideStatusLogContextMenu();
      });
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'config') {
        hostInput.value = message.payload.host;
        portInput.value = String(message.payload.port);
        savedConfig = {
          host: String(message.payload.host || '').trim(),
          port: Number.parseInt(String(message.payload.port || '0'), 10)
        };
        previousSavedConfig = null;
        isSaving = false;
        refreshSaveButton();
      }
      if (message.type === 'state') {
        if (isSaving && message.payload.runtimeStatus === 'error') {
          savedConfig = previousSavedConfig ? {
            host: previousSavedConfig.host,
            port: previousSavedConfig.port
          } : null;
          previousSavedConfig = null;
          isSaving = false;
          refreshSaveButton();
        }
        runtimeStatusElement.textContent = message.payload.runtimeMessage;
        runtimeStatusElement.className = 'status ' + message.payload.runtimeStatus;
        bridgeStatusElement.textContent = message.payload.bridgeMessage;
        bridgeStatusElement.className = 'status ' + message.payload.bridgeStatus;
      }
      if (message.type === 'logSchema') {
        if (!debugSwitch.enableSystemLog) {
          return;
        }

        const payload = message.payload || {};
        logFieldSchema = {
          fieldOrder: Array.isArray(payload.fieldOrder) ? payload.fieldOrder.slice() : [],
          fieldLabels: payload.fieldLabels && typeof payload.fieldLabels === 'object' ? payload.fieldLabels : {},
          defaultVisibleFields: Array.isArray(payload.defaultVisibleFields) ? payload.defaultVisibleFields.slice() : []
        };
        if (!(visibleStatusLogFields instanceof Set)) {
          visibleStatusLogFields = new Set();
          hasInitializedVisibleStatusLogFields = false;
        }
        statusLogMeasureCache.clear();
        renderStatusLogFieldSwitches();
      }
      if (message.type === 'logs') {
        if (debugSwitch.enableSystemLog) {
          renderStatusLogs(message.payload);
        }
      }
      if (message.type === 'clients') {
        if (debugSwitch.enableConnectionList) {
          renderConnectedClients(message.payload);
        }
      }
      if (message.type === 'instructions') {
        savedInstructions = String(message.payload || '');
        if (agentInstructionsTextarea) {
          agentInstructionsTextarea.value = savedInstructions;
        }
        refreshInstructionsSaveButton();
      }
      if (message.type === 'closeSidebarOnOpenEditor') {
        setCloseSidebarToggleState(message.payload);
      }
    });

    const closeSidebarToggleButton = document.getElementById('closeSidebarToggle');

    let closeSidebarOnOpenEditor = false;

    // 更新底部开关按钮的视觉状态。
    function setCloseSidebarToggleState(enabled) {
      closeSidebarOnOpenEditor = Boolean(enabled);
      if (closeSidebarToggleButton) {
        closeSidebarToggleButton.setAttribute('aria-checked', closeSidebarOnOpenEditor ? 'true' : 'false');
      }
    }

    if (closeSidebarToggleButton) {
      closeSidebarToggleButton.addEventListener('click', () => {
        const newValue = !closeSidebarOnOpenEditor;
        setCloseSidebarToggleState(newValue);
        vscode.postMessage({ command: 'setCloseSidebarOnOpenEditor', payload: newValue });
      });
    }

    new MutationObserver(() => {
      statusLogMeasureCache.clear();
      ensurePageScrollbar();
      ensureStatusLogScrollbar();
      ensureConnectionListScrollbar();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    refreshBridgeAddressPreview();
    setBridgeConfigCollapsed(true);
    setAiInstructionsCollapsed(true);
    if (debugSwitch.enableSystemLog) {
      setStatusLogCollapsed(true);
    }
    if (debugSwitch.enableConnectionList) {
      setConnectionListCollapsed(true);
    }
    ensurePageScrollbar();
    if (debugSwitch.enableSystemLog) {
      ensureStatusLogScrollbar();
    }
    if (debugSwitch.enableConnectionList) {
      ensureConnectionListScrollbar();
    }
    vscode.postMessage({ command: 'load' });
  </script>
</body>
</html>`;
}