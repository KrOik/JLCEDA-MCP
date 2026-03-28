/**
 * ------------------------------------------------------------------------
 * 名称：服务配置存储
 * 说明：封装 MCP 服务端 host 与 port 的读取、写入和校验逻辑。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：基于 VS Code 配置系统持久化参数。
 * ------------------------------------------------------------------------
 */

import * as vscode from 'vscode';
import type { ServerConfig } from '../../state/status';

export class ServerConfigStore implements vscode.Disposable {
  // 扩展配置节名称。
  private readonly section = 'jlcMcpServer';
  // 配置变更事件发射器。
  private readonly changeEmitter = new vscode.EventEmitter<ServerConfig>();
  // VS Code 配置变更订阅句柄。
  private readonly configurationChangeDisposable: vscode.Disposable;

  public constructor() {
    this.configurationChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('jlcMcpServer.host')
        && !event.affectsConfiguration('jlcMcpServer.port')
        && !event.affectsConfiguration('jlcMcpServer.agentInstructions')
        && !event.affectsConfiguration('jlcMcpServer.httpPort')) {
        return;
      }

      this.changeEmitter.fire(this.getConfig());
    });
  }

  /**
   * 订阅桥接监听配置变化事件。
   */
  public get onDidChangeConfig(): vscode.Event<ServerConfig> {
    return this.changeEmitter.event;
  }

  /**
   * 读取当前服务配置。
   * @returns 当前 host、port 与 httpPort。
   */
  public getConfig(): ServerConfig {
    const configuration = vscode.workspace.getConfiguration(this.section);
    const host = configuration.get<string>('host', '127.0.0.1');
    const port = configuration.get<number>('port', 8765);
    const httpPort = configuration.get<number>('httpPort', 7655);
    return { host, port, httpPort };
  }

  /**
   * 写入服务配置。
   * @param config 需要保存的服务配置。
   */
  public async updateConfig(config: ServerConfig): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(this.section);
    await configuration.update('host', config.host, vscode.ConfigurationTarget.Global);
    await configuration.update('port', config.port, vscode.ConfigurationTarget.Global);
    await configuration.update('httpPort', config.httpPort, vscode.ConfigurationTarget.Global);
  }

  /**
   * 读取 HTTP MCP 传输监听端口。
   * @returns HTTP 监听端口，0 表示禁用。
   */
  public getHttpPort(): number {
    return this.getConfig().httpPort;
  }

  /**
   * 读取当前 AI 助手指令。
   * @returns 用户自定义指令，未设置时返回空字符串。
   */
  public getAgentInstructions(): string {
    const configuration = vscode.workspace.getConfiguration(this.section);
    return configuration.get<string>('agentInstructions', '');
  }

  /**
   * 写入 AI 助手指令。
   * @param instructions 需要保存的指令文本。
   */
  public async updateAgentInstructions(instructions: string): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(this.section);
    await configuration.update('agentInstructions', instructions, vscode.ConfigurationTarget.Global);
  }

  /**
   * 校验输入配置并抛出明确错误。
   * @param config 待校验配置。
   */
  public validateConfig(config: ServerConfig): void {
    // host 不能为空，避免桥接监听参数错误。
    if (!config.host || config.host.trim().length === 0) {
      throw new Error('监听 IP 不能为空。');
    }

    // 端口必须是合法整数范围。
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error('端口必须是 1-65535 的整数。');
    }

    // HTTP MCP 端口必须是 0（禁用）或合法端口范围。
    if (!Number.isInteger(config.httpPort) || config.httpPort < 0 || config.httpPort > 65535) {
      throw new Error('HTTP MCP 端口必须是 0-65535 的整数（0 表示禁用）。');
    }
  }

  /**
   * 释放配置变更监听资源。
   */
  public dispose(): void {
    this.configurationChangeDisposable.dispose();
    this.changeEmitter.dispose();
  }
}
