import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

export interface SidebarTemplateAssets {
  nonce: string;
  cspSource: string;
  overlayScrollbarsCssUri: vscode.Uri;
  overlayScrollbarsScriptUri: vscode.Uri;
  iconsSpriteMarkup: string;
}

export function resolveSidebarTemplateAssets(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): SidebarTemplateAssets {
  const iconsSpriteFilePath = path.join(extensionUri.fsPath, 'resources', 'icons.svg');

  return {
    nonce: randomUUID(),
    cspSource: webview.cspSource,
    overlayScrollbarsCssUri: webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'overlayscrollbars', 'styles', 'overlayscrollbars.css'),
    ),
    overlayScrollbarsScriptUri: webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'node_modules', 'overlayscrollbars', 'browser', 'overlayscrollbars.browser.es6.js'),
    ),
    iconsSpriteMarkup: fs
      .readFileSync(iconsSpriteFilePath, 'utf8')
      .replace(/^\uFEFF?/, '')
      .replace(/<\?xml[^>]*>\s*/i, ''),
  };
}
