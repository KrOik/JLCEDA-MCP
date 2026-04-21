/**
 * ------------------------------------------------------------------------
 * 名称：宿主运行时 IPC 端点
 * 说明：统一生成宿主进程与 stdio Runtime 之间的 IPC 地址。
 * 作者：Codex
 * 日期：2026-04-21
 * 备注：Windows 使用 Named Pipe，其它平台使用临时目录 socket。
 * ------------------------------------------------------------------------
 */

import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';

function sanitizeSegment(value: string): string {
	return String(value ?? '')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '_')
		.replace(/^_+|_+$/g, '') || 'default';
}

function createEndpointName(sessionId: string, storageDirectoryPath: string): string {
	const safeSessionId = sanitizeSegment(sessionId);
	const scopeSource = `${safeSessionId}\0${path.resolve(storageDirectoryPath || '.')}`;
	const scopeHash = createHash('sha256').update(scopeSource).digest('hex').slice(0, 12);
	return `jlceda-mcp-host-${safeSessionId.slice(0, 32)}-${scopeHash}`;
}

export function createHostRuntimeIpcEndpoint(sessionId: string, storageDirectoryPath: string): string {
	const endpointName = createEndpointName(sessionId, storageDirectoryPath);
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\${endpointName}`;
	}

	return path.join(os.tmpdir(), `${endpointName}.sock`);
}
