import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const showErrorMessageMock = vi.fn();
const executeCommandMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

vi.mock('vscode', () => {
	return {
		EventEmitter: MockEventEmitter,
		window: {
			showErrorMessage: showErrorMessageMock,
		},
		commands: {
			executeCommand: executeCommandMock,
		},
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
			})),
		},
		env: {
			clipboard: {
				writeText: clipboardWriteTextMock,
			},
		},
	};
});

vi.mock('./sidebar-html', () => ({
	buildSidebarHtml: vi.fn(() => '<html><body>sidebar</body></html>'),
}));

describe('McpSidebarViewProvider', () => {
	beforeEach(() => {
		showErrorMessageMock.mockReset();
		executeCommandMock.mockReset();
		clipboardWriteTextMock.mockReset();
		vi.resetModules();
	});

	it('posts the current interaction immediately when the sidebar opens after an interaction already exists', async () => {
		const { McpSidebarViewProvider } = await import('./sidebar');

		const postMessageMock = vi.fn(async () => true);
		const currentInteraction = {
			kind: 'component-select' as const,
			requestId: 'req-existing',
			keyword: 'LMP7721MAX/NOPB',
			title: '器件选型',
			description: '请选择器件',
			noticeText: '',
			candidates: [
				{
					uuid: 'device-1',
					libraryUuid: 'lib-1',
					name: 'LMP7721MAX/NOPB',
					symbolName: 'LMP7721',
					footprintName: 'SOIC-8',
					description: 'opamp',
					manufacturer: 'TI',
					manufacturerId: 'ti',
					supplier: 'LCSC',
					supplierId: 'c2864387',
					lcscInventory: 10,
					lcscPrice: 12.5,
				},
			],
			pageSize: 5,
			currentPage: 1,
			timeoutSeconds: 60,
		};

		const hostRuntimeBridge = {
			onDidSnapshotChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidInteractionChange: vi.fn(() => ({ dispose: vi.fn() })),
			getLatestSnapshot: vi.fn(() => undefined),
			getCurrentInteraction: vi.fn(() => currentInteraction),
			sendInteractionResponse: vi.fn(),
		};

		const configStore = {
			getConfig: vi.fn(() => ({
				host: '127.0.0.1',
				port: 8765,
				httpPort: 7655,
			})),
			onDidChangeConfig: vi.fn(() => ({ dispose: vi.fn() })),
			getAgentInstructions: vi.fn(() => ''),
			getExposeRawApiTools: vi.fn(() => true),
			updateAgentInstructions: vi.fn(),
			updateExposeRawApiTools: vi.fn(),
			validateConfig: vi.fn(),
			updateConfig: vi.fn(),
		};

		const webviewView = {
			webview: {
				options: undefined,
				html: '',
				postMessage: postMessageMock,
				onDidReceiveMessage: vi.fn(),
			},
			visible: true,
			show: vi.fn(),
			onDidDispose: vi.fn(),
		};

		const provider = new McpSidebarViewProvider(
			{ fsPath: 'mock-extension-uri' } as never,
			'C:/workspace/storage',
			'session-test',
			configStore as never,
			hostRuntimeBridge as never,
			vi.fn(async () => undefined),
			vi.fn(async () => undefined),
		);

		provider.resolveWebviewView(webviewView as never);

		const interactionMessage = (postMessageMock.mock.calls as unknown as Array<[{
			type?: string;
			payload?: unknown;
		}]>)
			.map(([message]) => message)
			.find((message) => message.type === 'interaction');

		expect(interactionMessage).toEqual({
			type: 'interaction',
			payload: currentInteraction,
		});
	});
});
