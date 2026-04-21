import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_MCP_WS_URL,
	getConfiguredMcpUrl,
	MCP_SERVER_URL_CONFIG_KEY,
	normalizeMcpUrl,
	saveConfiguredMcpUrl,
} from './config';

interface StorageMock {
	getExtensionUserConfig: ReturnType<typeof vi.fn>;
	setExtensionUserConfig: ReturnType<typeof vi.fn>;
}

function installEdaStorageMock(): StorageMock {
	const storage: StorageMock = {
		getExtensionUserConfig: vi.fn(),
		setExtensionUserConfig: vi.fn().mockResolvedValue(undefined),
	}

	;(globalThis as typeof globalThis & {
		eda?: {
			sys_Storage: StorageMock;
		};
	}).eda = {
		sys_Storage: storage,
	};

	return storage;
}

describe('bridge config', () => {
	let storage: StorageMock;

	beforeEach(() => {
		storage = installEdaStorageMock();
	});

	it('normalizes valid websocket urls and trims whitespace', () => {
		expect(normalizeMcpUrl('  ws://127.0.0.1:8765/bridge/ws  ')).toBe('ws://127.0.0.1:8765/bridge/ws');
		expect(normalizeMcpUrl('wss://bridge.example.com/socket')).toBe('wss://bridge.example.com/socket');
	});

	it('rejects empty or non-websocket urls', () => {
		expect(() => normalizeMcpUrl('   ')).toThrow('桥接 WebSocket 地址不能为空');
		expect(() => normalizeMcpUrl('http://127.0.0.1:8765/bridge/ws')).toThrow('桥接地址协议仅支持 ws:// 或 wss://');
		expect(() => normalizeMcpUrl('not-a-url')).toThrow('桥接地址必须是完整的 ws:// 或 wss:// 地址');
	});

	it('falls back to default url when stored config is empty or invalid', () => {
		storage.getExtensionUserConfig.mockReturnValueOnce('');
		expect(getConfiguredMcpUrl()).toBe(DEFAULT_MCP_WS_URL);

		storage.getExtensionUserConfig.mockReturnValueOnce('http://invalid-host');
		expect(getConfiguredMcpUrl()).toBe(DEFAULT_MCP_WS_URL);
	});

	it('returns normalized configured url when storage contains a valid websocket url', () => {
		storage.getExtensionUserConfig.mockReturnValue('  ws://localhost:9000/custom/ws  ');

		expect(getConfiguredMcpUrl()).toBe('ws://localhost:9000/custom/ws');
		expect(storage.getExtensionUserConfig).toHaveBeenCalledWith(MCP_SERVER_URL_CONFIG_KEY);
	});

	it('persists normalized websocket urls', async () => {
		await saveConfiguredMcpUrl('  wss://bridge.example.com/runtime  ');

		expect(storage.setExtensionUserConfig).toHaveBeenCalledWith(
			MCP_SERVER_URL_CONFIG_KEY,
			'wss://bridge.example.com/runtime',
		);
	});

	it('rejects invalid websocket urls during persistence', async () => {
		await expect(saveConfiguredMcpUrl('https://bridge.example.com/runtime')).rejects.toThrow('桥接地址协议仅支持 ws:// 或 wss://');
		expect(storage.setExtensionUserConfig).not.toHaveBeenCalled();
	});
});
