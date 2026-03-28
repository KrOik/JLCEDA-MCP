/**
 * ------------------------------------------------------------------------
 * 名称：桥接配置管理
 * 说明：统一管理桥接地址读取、校验与配置变更广播主题。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：仅处理配置，不处理连接。
 * ------------------------------------------------------------------------
 */

export const MCP_SERVER_URL_CONFIG_KEY = 'jlc_mcp_server_url';
const MCP_SERVER_URL_CHANGED_TOPIC = 'jlc_mcp_server_url_changed';
export const DEFAULT_MCP_WS_URL = 'ws://127.0.0.1:8765/bridge/ws';

/**
 * 获取配置变更消息主题。
 * @returns 消息主题。
 */
export function getMcpServerUrlChangedTopic(): string {
	return MCP_SERVER_URL_CHANGED_TOPIC;
}

/**
 * 归一化桥接地址。
 * @param raw 输入地址。
 * @returns 归一化后的地址字符串。
 */
export function normalizeMcpUrl(raw: string): string {
	const normalized = String(raw ?? '').trim();
	if (normalized.length === 0) {
		throw new Error('桥接 WebSocket 地址不能为空。');
	}

	let parsed: URL;
	try {
		parsed = new URL(normalized);
	}
	catch {
		throw new Error('桥接地址必须是完整的 ws:// 或 wss:// 地址。');
	}

	if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
		throw new Error('桥接地址协议仅支持 ws:// 或 wss://。');
	}

	return normalized;
}

/**
 * 读取保存的桥接地址。
 * @returns 配置地址。
 */
export function getConfiguredMcpUrl(): string {
	const value = eda.sys_Storage.getExtensionUserConfig(MCP_SERVER_URL_CONFIG_KEY);
	if (typeof value !== 'string' || value.trim().length === 0) {
		return DEFAULT_MCP_WS_URL;
	}

	try {
		return normalizeMcpUrl(value);
	}
	catch {
		return DEFAULT_MCP_WS_URL;
	}
}

/**
 * 持久化桥接地址。
 * @param bridgeWebSocketUrl 桥接地址。
 */
export async function saveConfiguredMcpUrl(bridgeWebSocketUrl: string): Promise<void> {
	await eda.sys_Storage.setExtensionUserConfig(MCP_SERVER_URL_CONFIG_KEY, normalizeMcpUrl(bridgeWebSocketUrl));
}
