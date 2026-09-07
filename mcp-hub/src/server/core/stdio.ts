/**
 * ------------------------------------------------------------------------
 * 名称：stdio 定义构造器
 * 说明：集中生成 VS Code 与 Cursor 共用的 stdio MCP 服务定义。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-10
 * 备注：统一维护运行时命令、参数与标识，避免宿主分流逻辑重复。
 * ------------------------------------------------------------------------
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { ServerConfig } from '../../state/status';


// Cursor 侧注册使用的 MCP 服务名称。
export const JLC_MCP_SERVER_NAME = 'chengbin.jlceda-mcp-hub';

export interface CursorStdioServerConfig {
  name: string;
  server: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

// 获取当前扩展的本地 Node 运行时命令。
function getRuntimeCommand(): string {
  return process.execPath;
}

// 获取 MCP stdio 运行时入口脚本绝对路径。
function getRuntimeScriptPath(extensionPath: string): string {
  return path.join(extensionPath, 'scripts', 'service.mjs');
}

// 统一构造 stdio 运行时启动参数。
function getRuntimeArgs(
  extensionPath: string,
  storageDirectoryPath: string,
  sessionId: string,
  config: ServerConfig,
  extensionVersion: string,
  httpPort: number,
  exposeRawApiTools: boolean,
  agentInstructions: string,
): string[] {
  const args = [
    getRuntimeScriptPath(extensionPath), 'stdio', '--port', String(config.port),
    '--http-port', String(httpPort || 7655),
  ];
  if (exposeRawApiTools) args.push('--expose-raw-api-tools');
  if (agentInstructions) args.push('--agent-instructions', Buffer.from(agentInstructions, 'utf8').toString('base64'));
  return args;
}

/**
 * 创建 VS Code 使用的 stdio MCP 服务定义。
 * @param extensionPath 扩展目录绝对路径。
 * @param config 当前桥接监听配置。
 * @param version 服务定义版本号。
 * @param httpPort HTTP MCP 传输监听端口，0 表示禁用。
 * @returns VS Code stdio MCP 服务定义。
 */
export function createVscodeStdioServerDefinition(
  extensionPath: string,
  storageDirectoryPath: string,
  sessionId: string,
  config: ServerConfig,
  version: string,
  httpPort: number,
  exposeRawApiTools: boolean,
  agentInstructions: string,
): vscode.McpStdioServerDefinition {
  const definition = new vscode.McpStdioServerDefinition(
    '嘉立创 EDA',
    getRuntimeCommand(),
    getRuntimeArgs(extensionPath, storageDirectoryPath, sessionId, config, version, httpPort, exposeRawApiTools, agentInstructions),
    { ELECTRON_RUN_AS_NODE: '1' },
    version
  );
  definition.cwd = vscode.Uri.file(extensionPath);
  return definition;
}

/**
 * 创建 Cursor 使用的 stdio MCP 服务定义。
 * @param extensionPath 扩展目录绝对路径。
 * @param config 当前桥接监听配置。
 * @param version 服务定义版本号。
 * @param httpPort HTTP MCP 传输监听端口，0 表示禁用。
 * @returns Cursor stdio MCP 服务定义。
 */
export function createCursorStdioServerConfig(
  extensionPath: string,
  storageDirectoryPath: string,
  sessionId: string,
  config: ServerConfig,
  version: string,
  httpPort: number,
  exposeRawApiTools: boolean,
  agentInstructions: string,
): CursorStdioServerConfig {
  return {
    name: JLC_MCP_SERVER_NAME,
    server: {
      command: getRuntimeCommand(),
      args: getRuntimeArgs(extensionPath, storageDirectoryPath, sessionId, config, version, httpPort, exposeRawApiTools, agentInstructions),
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  };
}
