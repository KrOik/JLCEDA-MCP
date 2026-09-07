import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface BridgeTransportCallbacks {
	onRoleChanged: (message: {
		role: 'active' | 'standby';
		clientId: string;
		activeClientId: string;
		leaseTerm: number;
		reason: string;
	}) => void;
	onDebugSwitchChanged: (debugSwitch: Record<string, unknown>) => void;
	onTask: (task: {
		requestId: string;
		path: string;
		payload: unknown;
		createdAt: number;
		leaseTerm: number;
	}) => Promise<void>;
	onLost: (message: string) => void;
}

interface MockLogEntry {
	level: 'info' | 'warning';
	module: string;
	event: string;
	summary: string;
	message: string;
	bridgeWebSocketUrl?: string;
	clientId?: string;
	activeClientId?: string;
	leaseTerm?: string;
	detail?: string;
	errorCode?: string;
}

const handlerMocks = {
	handleApiIndexTask: vi.fn(async () => ({ ok: 'api-index' })),
	handleApiSearchTask: vi.fn(async () => ({ ok: 'api-search' })),
	handleApiInvokeTask: vi.fn(async () => ({ ok: 'api-invoke' })),
	handleComponentPlaceCheckTask: vi.fn(async () => ({ ok: 'place-check' })),
	handleComponentPlaceCloseTask: vi.fn(async () => ({ ok: 'place-close' })),
	handleComponentPlaceStartTask: vi.fn(async () => ({ ok: 'place-start' })),
	handleComponentPlaceTask: vi.fn(async () => ({ ok: 'place' })),
	handleComponentSelectTask: vi.fn(async () => ({ ok: 'component-select' })),
	handleEdaContextTask: vi.fn(async payload => ({ payload })),
	handlePcbConstraintSnapshotTask: vi.fn(async () => ({ ok: 'pcb-constraint' })),
	handlePcbGeometryAnalyzeTask: vi.fn(async () => ({ ok: 'pcb-geometry-analyze' })),
	handlePcbSnapshotTask: vi.fn(async () => ({ ok: 'pcb-snapshot' })),
	handleSchematicLocateTask: vi.fn(async () => ({ ok: 'schematic-locate' })),
	handleSchematicReadTask: vi.fn(async () => ({ ok: 'schematic-read' })),
	handleSchematicReviewTask: vi.fn(async () => ({ ok: 'schematic-review' })),
};

const bridgeTransportInstances: MockBridgeTransport[] = [];
const mockLogEntries: MockLogEntry[] = [];
const consoleWarnMock = vi.fn();
const bridgeLogDispatchPipelineState = {
	setDebugSwitch: vi.fn(),
	flushToTransport: vi.fn(),
	enqueue: vi.fn(),
	resetHandshakeState: vi.fn(),
};
const bridgeStatusReporterState = {
	markConnecting: vi.fn(),
	markRole: vi.fn(),
	markFailed: vi.fn(),
	markNotOnEditablePage: vi.fn(),
};
const showToastMessageMock = vi.fn();
const messageBusSubscribeMock = vi.fn(() => ({ running: () => true }));

class MockBridgeTransport {
	public readonly connect = vi.fn(async () => undefined);
	public readonly reportReady = vi.fn();
	public readonly updateContext = vi.fn();
	public readonly setExecutingTask = vi.fn();
	public readonly close = vi.fn();
	public readonly completeTask = vi.fn();

	public constructor(
		public readonly url: string,
		public readonly socketId: string,
		public readonly clientId: string,
		public readonly version: string,
		public readonly callbacks: BridgeTransportCallbacks,
	) {
		bridgeTransportInstances.push(this);
	}
}

vi.mock('../../extension.json', () => ({
	default: {
		version: '1.5.5',
	},
}));

vi.mock('../bridge/config.ts', () => ({
	getConfiguredMcpUrl: vi.fn(() => 'ws://127.0.0.1:8765/bridge/ws'),
	getMcpServerUrlChangedTopic: vi.fn(() => 'bridge/config/changed'),
}));

vi.mock('../bridge/protocol.ts', () => ({
	toBridgeProtocolError: vi.fn((error: unknown, message: string) => ({
		message,
		raw: String(error),
	})),
}));

vi.mock('../logging/log.ts', () => ({
	bridgeLogPipeline: {
		createEntry: vi.fn((input: MockLogEntry) => input),
		append: vi.fn((entry: MockLogEntry) => {
			mockLogEntries.push(entry);
			return entry;
		}),
		format: vi.fn((entry: MockLogEntry) => JSON.stringify(entry)),
		setListener: vi.fn(),
	},
}));

vi.mock('../logging/log-dispatch.ts', () => ({
	BridgeLogDispatchPipeline: vi.fn().mockImplementation(() => ({
		setDebugSwitch: bridgeLogDispatchPipelineState.setDebugSwitch,
		flushToTransport: bridgeLogDispatchPipelineState.flushToTransport,
		enqueue: bridgeLogDispatchPipelineState.enqueue,
		resetHandshakeState: bridgeLogDispatchPipelineState.resetHandshakeState,
	})),
}));

vi.mock('../mcp/api-index-handler.ts', () => ({
	handleApiIndexTask: handlerMocks.handleApiIndexTask,
}));
vi.mock('../mcp/type-rows-handler.ts', () => ({
	handleTypeRowsTask: vi.fn(), isRowsIdle: () => true, rowsWriteBlocked: () => false, setOwnershipGuard: vi.fn(), getBackgroundState: () => undefined,
}));

vi.mock('../mcp/api-search-handler.ts', () => ({
	handleApiSearchTask: handlerMocks.handleApiSearchTask,
}));

vi.mock('../mcp/component-place-handler.ts', () => ({
	isPlacementIdle: () => true,
	handleComponentPlaceCheckTask: handlerMocks.handleComponentPlaceCheckTask,
	handleComponentPlaceCloseTask: handlerMocks.handleComponentPlaceCloseTask,
	handleComponentPlaceStartTask: handlerMocks.handleComponentPlaceStartTask,
	handleComponentPlaceTask: handlerMocks.handleComponentPlaceTask,
}));

vi.mock('../mcp/component-select-handler.ts', () => ({
	handleComponentSelectTask: handlerMocks.handleComponentSelectTask,
	handleComponentMatchTask: handlerMocks.handleComponentSelectTask,
}));

vi.mock('../mcp/context-handler.ts', () => ({
	handleEdaContextTask: handlerMocks.handleEdaContextTask,
}));

vi.mock('../mcp/invoke-handler.ts', () => ({
	handleApiInvokeTask: handlerMocks.handleApiInvokeTask,
}));

vi.mock('../mcp/pcb-constraint-handler.ts', () => ({
	handlePcbConstraintSnapshotTask: handlerMocks.handlePcbConstraintSnapshotTask,
}));

vi.mock('../mcp/pcb-geometry-handler.ts', () => ({
	handlePcbGeometryAnalyzeTask: handlerMocks.handlePcbGeometryAnalyzeTask,
	handlePcbSnapshotTask: handlerMocks.handlePcbSnapshotTask,
}));

vi.mock('../mcp/schematic-locator-handler.ts', () => ({
	handleSchematicLocateTask: handlerMocks.handleSchematicLocateTask,
}));

vi.mock('../mcp/schematic-read-handler.ts', () => ({
	handleSchematicReadTask: handlerMocks.handleSchematicReadTask,
}));

vi.mock('../mcp/schematic-review-handler.ts', () => ({
	handleSchematicReviewTask: handlerMocks.handleSchematicReviewTask,
}));

vi.mock('../state/state-manager.ts', () => ({
	BridgeStateManager: class {
		public static text = {
			connection: {
				connectSuccessToast: 'connected',
			},
			runtime: {
				taskRejectedStandby: 'runtime standby',
				taskLeaseExpired: 'lease expired',
				taskPathUnsupportedPrefix: 'unsupported path: ',
				taskFailedSummary: 'task failed',
				connectedToastFailedSummary: 'toast failed',
			},
		};
	},
}));

vi.mock('../state/status-reporter.ts', () => ({
	BridgeStatusReporter: vi.fn().mockImplementation(() => ({
		markConnecting: bridgeStatusReporterState.markConnecting,
		markRole: bridgeStatusReporterState.markRole,
		markFailed: bridgeStatusReporterState.markFailed,
		markNotOnEditablePage: bridgeStatusReporterState.markNotOnEditablePage,
	})),
}));

vi.mock('../utils.ts', () => ({
	safeCall: vi.fn(async (fn: () => unknown) => await fn()),
	toSafeErrorMessage: vi.fn((error: unknown) => error instanceof Error ? error.message : String(error)),
	toSerializableAsync: vi.fn(async (value: unknown) => value),
}));

vi.mock('./bridge-transport.ts', () => ({
	BridgeTransport: MockBridgeTransport,
}));

function installEdaMock(): void {
	(globalThis as typeof globalThis & {
		eda?: {
			sys_Message: {
				showToastMessage: typeof showToastMessageMock;
			};
			sys_MessageBus: {
				subscribe: typeof messageBusSubscribeMock;
			};
			dmt_Schematic: {
				getCurrentSchematicPageInfo: () => { id: string };
			};
			dmt_Pcb: {
				getCurrentPcbInfo: () => null;
			};
			dmt_SelectControl: { getCurrentDocumentInfo: () => { uuid: string; documentType: number } };
		};
	}).eda = {
		sys_Message: {
			showToastMessage: showToastMessageMock,
		},
		sys_MessageBus: {
			subscribe: messageBusSubscribeMock,
		},
		dmt_Schematic: {
			getCurrentSchematicPageInfo: () => ({ id: 'sch-1' }),
		},
		dmt_Pcb: {
			getCurrentPcbInfo: () => null,
		},
		dmt_SelectControl: { getCurrentDocumentInfo: () => ({ uuid: 'sch-1', documentType: 1 }) },
	};
}

async function startRuntime(): Promise<{
	startBridgeRuntime: () => void;
	transport: MockBridgeTransport;
}> {
	const runtimeModule = await import('./bridge-runtime.ts');
	runtimeModule.startBridgeRuntime();
	await flushTaskQueue();
	const transport = bridgeTransportInstances.at(-1);
	if (!transport) {
		throw new Error('runtime transport was not created');
	}

	return {
		startBridgeRuntime: runtimeModule.startBridgeRuntime,
		transport,
	};
}

async function flushTaskQueue(): Promise<void> {
	for (let index = 0; index < 16; index += 1) {
		await Promise.resolve();
	}
}

describe('bridge runtime', () => {
	let runtimeTransport: MockBridgeTransport;

	beforeAll(async () => {
		vi.useFakeTimers();
		vi.spyOn(console, 'warn').mockImplementation(consoleWarnMock);
		installEdaMock();
		const { transport } = await startRuntime();
		runtimeTransport = transport;
	});

	beforeEach(() => {
		mockLogEntries.length = 0;
		showToastMessageMock.mockReset();
		messageBusSubscribeMock.mockClear();
		consoleWarnMock.mockClear();
		bridgeLogDispatchPipelineState.setDebugSwitch.mockClear();
		bridgeLogDispatchPipelineState.flushToTransport.mockClear();
		bridgeLogDispatchPipelineState.enqueue.mockClear();
		bridgeLogDispatchPipelineState.resetHandshakeState.mockClear();
		bridgeStatusReporterState.markConnecting.mockClear();
		bridgeStatusReporterState.markRole.mockClear();
		bridgeStatusReporterState.markFailed.mockClear();
		bridgeStatusReporterState.markNotOnEditablePage.mockClear();
		for (const handlerMock of Object.values(handlerMocks)) {
			handlerMock.mockClear();
		}
		runtimeTransport.completeTask.mockClear();
		runtimeTransport.close.mockClear();
		runtimeTransport.connect.mockClear();
		runtimeTransport.reportReady.mockClear();
	});

	afterAll(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		delete (globalThis as typeof globalThis & { eda?: unknown }).eda;
	});

	it('dispatches schematic locate tasks through the bridge route map', async () => {
		runtimeTransport.callbacks.onRoleChanged({
			role: 'active',
			clientId: 'client-a',
			activeClientId: 'client-a',
			leaseTerm: 9,
			reason: 'promoted',
		});

		await runtimeTransport.callbacks.onTask({
			requestId: 'req-locate',
			path: '/bridge/jlceda/schematic/locate',
			payload: { query: 'U1' },
			createdAt: Date.now(),
			leaseTerm: 9,
		});
		await flushTaskQueue();

		expect(handlerMocks.handleSchematicLocateTask).toHaveBeenCalledWith({ query: 'U1' });
		expect(runtimeTransport.completeTask).toHaveBeenCalledWith(
			'req-locate',
			9,
			{ ok: 'schematic-locate' },
			undefined,
		);
		expect(mockLogEntries.some(entry => entry.event === 'bridge.task.rejected.unsupported_path')).toBe(false);
	});

	it('emits a warning log for slow completed tasks with timing detail', async () => {
		handlerMocks.handleEdaContextTask.mockImplementationOnce(async (payload) => {
			await new Promise((resolve) => {
				setTimeout(resolve, 3205);
			});
			return { payload, ok: true };
		});

		runtimeTransport.callbacks.onRoleChanged({
			role: 'active',
			clientId: 'client-b',
			activeClientId: 'client-b',
			leaseTerm: 3,
			reason: 'promoted',
		});

		const taskPromise = runtimeTransport.callbacks.onTask({
			requestId: 'req-slow',
			path: '/bridge/jlceda/context',
			payload: { scope: 'sch' },
			createdAt: Date.now() - 40,
			leaseTerm: 3,
		});

		await vi.advanceTimersByTimeAsync(3210);
		await taskPromise;

		const completedEntry = mockLogEntries.find(entry => entry.event === 'bridge.task.completed');
		expect(completedEntry).toMatchObject({
			level: 'warning',
			event: 'bridge.task.completed',
			errorCode: 'bridge_task_slow',
		});
		expect(completedEntry?.detail).toContain('"totalElapsedMs":');
		expect(completedEntry?.detail).toContain('"handlerElapsedMs":');
		expect(completedEntry?.detail).toContain('"queueDelayMs":40');
		expect(runtimeTransport.completeTask).toHaveBeenCalledWith(
			'req-slow',
			3,
			expect.objectContaining({ payload: { scope: 'sch' }, ok: true, hotUpdate: expect.any(Object) }),
			undefined,
		);
		expect(consoleWarnMock).toHaveBeenCalled();
	});
});
