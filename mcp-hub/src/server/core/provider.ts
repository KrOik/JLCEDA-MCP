/**
 * ------------------------------------------------------------------------
 * 名称：MCP 定义提供器
 * 说明：向 VS Code 提供 stdio MCP 服务定义并响应配置变化。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：用于 Copilot 工具发现与连接。
 * ------------------------------------------------------------------------
 */

import * as vscode from 'vscode';
import type { ServerConfigStore } from './config';
import { createVscodeStdioServerDefinition } from './stdio';

export class JlcMcpDefinitionProvider
implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly configChangeDisposable: vscode.Disposable;

  public constructor(
    private readonly extensionPath: string,
    private readonly storageDirectoryPath: string,
    private readonly sessionId: string,
    private readonly configStore: ServerConfigStore,
    private readonly extensionVersion: string,
    // VS Code 拉起 stdio 进程前的回调，用于停止扩展自动拉起的预热进程，避免端口冲突。
    private readonly onBeforeStart?: () => void
  ) {
    this.configChangeDisposable = this.configStore.onDidChangeConfig(() => {
      this.changeEmitter.fire();
    });
  }

  /**
   * 订阅 MCP 服务定义变化事件。
   */
  public get onDidChangeMcpServerDefinitions(): vscode.Event<void> {
    return this.changeEmitter.event;
  }

  /**
   * 提供 MCP 服务定义，用于让 Copilot 发现工具。
   * @returns MCP stdio 服务定义列表。
   */
  public provideMcpServerDefinitions(): vscode.ProviderResult<vscode.McpStdioServerDefinition[]> {
    const config = this.configStore.getConfig();
    this.configStore.validateConfig(config);
    return [createVscodeStdioServerDefinition(this.extensionPath, this.storageDirectoryPath, this.sessionId, config, this.extensionVersion, this.configStore.getAgentInstructions(), this.configStore.getHttpPort(), this.configStore.getExposeRawApiTools())];
  }

  /**
   * 解析 MCP stdio 服务定义。
   * @param server 当前待启动的 MCP 服务定义。
   * @returns 原样返回的 stdio 服务定义。
   */
  public async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition
  ): Promise<vscode.McpStdioServerDefinition> {
    // 先停止扩展自动拉起的预热进程，确保 VS Code 即将 spawn 的进程可正常绑定端口。
    this.onBeforeStart?.();
    return server;
  }

  /**
   * 释放定义刷新相关资源。
   */
  public dispose(): void {
    this.configChangeDisposable.dispose();
    this.changeEmitter.dispose();
  }
}
