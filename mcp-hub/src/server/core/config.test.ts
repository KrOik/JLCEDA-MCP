import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../../state/status';

const configurationState = new Map<string, unknown>();
const updateMock = vi.fn(async (key: string, value: unknown) => {
	configurationState.set(key, value);
});
const affectsConfigurationMock = vi.fn<(section: string) => boolean>();
let configurationChangeHandler: ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined;

class MockEventEmitter<T> {
	private readonly listeners = new Set<(value: T) => void>();

	public readonly event = (listener: (value: T) => void) => {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	};

	public fire(value: T): void {
		for (const listener of this.listeners) {
			listener(value);
		}
	}

	public dispose(): void {
		this.listeners.clear();
	}
}

vi.mock('vscode', () => {
	return {
		ConfigurationTarget: {
			Global: 'global',
		},
		EventEmitter: MockEventEmitter,
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn((key: string, defaultValue: unknown) => {
					return configurationState.has(key) ? configurationState.get(key) : defaultValue;
				}),
				update: updateMock,
			})),
			onDidChangeConfiguration: vi.fn((handler: (event: { affectsConfiguration(section: string): boolean }) => void) => {
				configurationChangeHandler = handler;
				return {
					dispose: vi.fn(),
				};
			}),
		},
	};
});

describe('ServerConfigStore', () => {
	beforeEach(() => {
		configurationState.clear();
		updateMock.mockClear();
		affectsConfigurationMock.mockReset();
		configurationChangeHandler = undefined;
		vi.resetModules();
	});

	it('reads default config and helper values', async () => {
		const { ServerConfigStore } = await import('./config');
		const store = new ServerConfigStore();

		expect(store.getConfig()).toEqual({
			host: '127.0.0.1',
			port: 8765,
			httpPort: 7655,
		});
		expect(store.getHttpPort()).toBe(7655);
		expect(store.getExposeRawApiTools()).toBe(false);
		expect(store.getAgentInstructions()).toBe('');

		store.dispose();
	});

	it('updates config values and optional toggles through the vscode configuration API', async () => {
		const { ServerConfigStore } = await import('./config');
		const store = new ServerConfigStore();
		const nextConfig: ServerConfig = {
			host: '0.0.0.0',
			port: 9001,
			httpPort: 0,
		};

		await store.updateConfig(nextConfig);
		await store.updateExposeRawApiTools(true);
		await store.updateAgentInstructions('use schematic_review first');

		expect(updateMock).toHaveBeenNthCalledWith(1, 'host', '0.0.0.0', 'global');
		expect(updateMock).toHaveBeenNthCalledWith(2, 'port', 9001, 'global');
		expect(updateMock).toHaveBeenNthCalledWith(3, 'httpPort', 0, 'global');
		expect(updateMock).toHaveBeenNthCalledWith(4, 'exposeRawApiTools', true, 'global');
		expect(updateMock).toHaveBeenNthCalledWith(5, 'agentInstructions', 'use schematic_review first', 'global');

		store.dispose();
	});

	it('emits a config change when watched settings change', async () => {
		const { ServerConfigStore } = await import('./config');
		const store = new ServerConfigStore();
		const listener = vi.fn();

		configurationState.set('host', '192.168.1.10');
		configurationState.set('port', 9002);
		configurationState.set('httpPort', 7666);
		store.onDidChangeConfig(listener);

		configurationChangeHandler?.({
			affectsConfiguration(section: string) {
				return section === 'jlcMcpServer.port';
			},
		});

		expect(listener).toHaveBeenCalledWith({
			host: '192.168.1.10',
			port: 9002,
			httpPort: 7666,
		});

		store.dispose();
	});

	it('ignores unrelated configuration changes', async () => {
		const { ServerConfigStore } = await import('./config');
		const store = new ServerConfigStore();
		const listener = vi.fn();

		store.onDidChangeConfig(listener);
		configurationChangeHandler?.({
			affectsConfiguration() {
				return false;
			},
		});

		expect(listener).not.toHaveBeenCalled();

		store.dispose();
	});

	it('validates host and port boundaries', async () => {
		const { ServerConfigStore } = await import('./config');
		const store = new ServerConfigStore();

		expect(() => store.validateConfig({ host: '', port: 8765, httpPort: 7655 })).toThrow('监听 IP 不能为空。');
		expect(() => store.validateConfig({ host: '127.0.0.1', port: 0, httpPort: 7655 })).toThrow('端口必须是 1-65535 的整数。');
		expect(() => store.validateConfig({ host: '127.0.0.1', port: 8765, httpPort: -1 })).toThrow('HTTP MCP 端口必须是 0-65535 的整数（0 表示禁用）。');
		expect(() => store.validateConfig({ host: '127.0.0.1', port: 8765, httpPort: 65536 })).toThrow('HTTP MCP 端口必须是 0-65535 的整数（0 表示禁用）。');
		expect(() => store.validateConfig({ host: '127.0.0.1', port: 8765, httpPort: 0 })).not.toThrow();

		store.dispose();
	});
});
