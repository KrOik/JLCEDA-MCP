import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDispatcherInteractionChannel } from './tool-dispatcher';

const enqueueBridgeRequestMock = vi.fn();

vi.mock('../bridge/broker', () => {
	return {
		enqueueBridgeRequest: enqueueBridgeRequestMock,
	};
});

describe('ToolDispatcher', () => {
	it('accepts string batch queries and identifies invalid batch fields before any search', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:/tmp', 'input-recovery');
		const invalid = await dispatcher.dispatch({ name: 'component_select', arguments: { queries: [{ keyword: 'valid' }, {}] } }) as any;
		expect(JSON.parse(invalid.content[0].text)).toMatchObject({ errorCode: 'INVALID_ARGUMENT', executed: false, error: expect.stringContaining('queries[1]') });
		expect(enqueueBridgeRequestMock).not.toHaveBeenCalled();
		enqueueBridgeRequestMock.mockResolvedValue({ ok: true, candidates: [] });
		const valid = await dispatcher.dispatch({ name: 'component_select', arguments: { queries: ['string-query-unique'] } }) as any;
		expect(JSON.parse(valid.content[0].text).ok).toBe(true);
		expect(enqueueBridgeRequestMock).toHaveBeenCalledWith('/bridge/jlceda/component/match', { keyword: 'string-query-unique', limit: 5, page: 1 }, 30000);
	});
	it('returns candidates once, reuses cache, and expands candidateRef before placement', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:/tmp', 'refs');
		enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true, candidates: [{ uuid: 'real-device', libraryUuid: 'real-library', name: 'MCU', footprintName: 'QFP', exactMatch: true }], page: 1 });
		const selected = await dispatcher.dispatch({ name: 'component_select', arguments: { keyword: 'unique-refs' } }) as any;
		expect(selected).not.toHaveProperty('structuredContent');
		const value = JSON.parse(selected.content[0].text);
		expect(value.candidates[0]).not.toHaveProperty('uuid');
		const repeated = await dispatcher.dispatch({ name: 'component_select', arguments: { keyword: ' unique-refs ' } });
		expect(repeated).toEqual(selected); expect(enqueueBridgeRequestMock).toHaveBeenCalledTimes(1);
		const detail = await dispatcher.dispatch({ name: 'result_read', arguments: { resultRef: value.resultRef } }) as any;
		expect(JSON.parse(JSON.parse(detail.content[0].text).text).candidates[0].uuid).toBe('real-device');
		enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true, results: [] });
		await dispatcher.dispatch({ name: 'component_place', arguments: { components: [{ candidateRef: value.candidates[0].candidateRef, group: 'core' }] } });
		expect(enqueueBridgeRequestMock).toHaveBeenLastCalledWith('/bridge/jlceda/component/place-auto', { components: [{ uuid: 'real-device', libraryUuid: 'real-library', group: 'core' }] }, 120000);
	});
	it('batches duplicate searches without additional upstream calls', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:/tmp', 'batch');
		enqueueBridgeRequestMock.mockResolvedValue({ ok: true, candidates: [] });
		const result = await dispatcher.dispatch({ name: 'component_select', arguments: { queries: [{ keyword: 'batch-unique' }, { keyword: 'batch-unique' }] } }) as any;
		expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: true, searches: [{ index: 0 }, { index: 1 }], remainingIndices: [] });
		expect(enqueueBridgeRequestMock).toHaveBeenCalledTimes(1);
	});
	it('passes includeGeometry through and supports explicit legacy full responses', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:/tmp', 'geometry');
		enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true, geometry: [] });
		const response = await dispatcher.dispatch({ name: 'schematic_read', arguments: { includeGeometry: true, responseDetail: 'full' } });
		expect(response).toMatchObject({ structuredContent: { ok: true, geometry: [] } });
		expect(enqueueBridgeRequestMock).toHaveBeenLastCalledWith('/bridge/jlceda/schematic/read', { includeGeometry: true }, 15000);
	});
	it('preserves partial batch results and does not issue remaining searches after failure', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:/tmp', 'batch-partial');
		enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true, candidates: [] }).mockRejectedValueOnce(new Error('BRIDGE_OFFLINE'));
		const response = await dispatcher.dispatch({ name: 'component_select', arguments: { queries: [{ keyword: 'partial-a' }, { keyword: 'partial-b' }, { keyword: 'partial-c' }] } }) as any;
		expect(JSON.parse(response.content[0].text)).toMatchObject({ ok: false, searches: [{ ok: true, index: 0 }, { ok: false, index: 1, error: 'BRIDGE_OFFLINE' }], remainingIndices: [1, 2] });
		expect(enqueueBridgeRequestMock).toHaveBeenCalledTimes(2);
	});
	function createInteractionChannelMock(): ToolDispatcherInteractionChannel {
		return {
			publish: vi.fn(),
			waitForResponse: vi.fn(),
			tryConsumeResponse: vi.fn().mockReturnValue(null),
		};
	}

	beforeEach(() => {
		enqueueBridgeRequestMock.mockReset();
	});

	it('exposes only the base tool set by default', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const interactionChannel = createInteractionChannelMock();
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, interactionChannel);

		expect(dispatcher.getToolDefinitions().map((item) => item.name)).toEqual([
			'schematic_place_rows',
			'schematic_read',
			'schematic_locate',
			'schematic_review',
			'schematic_relayout',
			'pcb_snapshot',
			'pcb_geometry_analyze',
			'pcb_constraint_snapshot',
			'component_select',
			'component_place',
			'pin_net_configure',
			'bridge_status',
			'result_read',
			'document_focus',
		]);
	});

	it('includes passthrough tools when raw API exposure is enabled', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', true, createInteractionChannelMock());

		expect(dispatcher.getToolDefinitions().map((item) => item.name)).toEqual([
			'schematic_place_rows',
			'api_index',
			'api_search',
			'api_invoke',
			'eda_context',
			'schematic_read',
			'schematic_locate',
			'schematic_review',
			'schematic_relayout',
			'pcb_snapshot',
			'pcb_geometry_analyze',
			'pcb_constraint_snapshot',
			'component_select',
			'component_place',
			'pin_net_configure',
			'bridge_status',
			'result_read',
			'document_focus',
		]);

		dispatcher.updateExposeRawApiTools(false);
		expect(dispatcher.getToolDefinitions()).toHaveLength(14);
	});

	it('forwards schematic_locate to the bridge with bounded parameters', async () => {
		enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true, matches: [] });
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, createInteractionChannelMock());

		const result = await dispatcher.dispatch({
			name: 'schematic_locate',
			arguments: {
				query: ' ESP32-PICO-V3-02 ',
				scope: 'all-schematics',
				limit: 12,
				timeoutMs: 20000,
			},
		});

		expect(enqueueBridgeRequestMock).toHaveBeenCalledWith('/bridge/jlceda/schematic/locate', {
			query: 'ESP32-PICO-V3-02',
			scope: 'all-schematics',
			limit: 12,
		}, 20000);
		expect(result).toMatchObject({
			content: [{ type: 'text', text: '{"ok":true,"matches":[]}' }],
		});
	});

	it('forwards the preview-first schematic relayout request unchanged', async () => {
		enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true, dryRun: true, positions: [] });
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'relayout', false, createInteractionChannelMock());
		await dispatcher.dispatch({ name: 'schematic_relayout', arguments: { componentIds: ['u1'], layout: { mode: 'elk' } } });
		expect(enqueueBridgeRequestMock).toHaveBeenLastCalledWith('/bridge/jlceda/schematic/relayout', { componentIds: ['u1'], layout: { mode: 'elk' } }, 15000);
	});

	it('rejects unknown tools before reaching the bridge', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, createInteractionChannelMock());

		await expect(dispatcher.dispatch({ name: 'unknown_tool' })).rejects.toThrow('未知工具: unknown_tool');
		expect(enqueueBridgeRequestMock).not.toHaveBeenCalled();
	});

	it('rejects component_select when keyword is missing', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, createInteractionChannelMock());

		const result = await dispatcher.dispatch({ name: 'component_select', arguments: {} }) as any;
		expect(result.isError).toBe(true);
		expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, errorCode: 'INVALID_ARGUMENT', executed: false });
		expect(enqueueBridgeRequestMock).not.toHaveBeenCalled();
	});

	it('validates api_search query and scope before bridge dispatch', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', true, createInteractionChannelMock());

		await expect(dispatcher.dispatch({ name: 'api_search', arguments: {} })).rejects.toThrow('api_search 缺少 query 参数。');
		await expect(dispatcher.dispatch({
			name: 'api_search',
			arguments: { query: 'bom', scope: 'invalid' },
		})).rejects.toThrow('scope 仅支持 all/callable/type。');
		expect(enqueueBridgeRequestMock).not.toHaveBeenCalled();
	});

	it('rejects api_invoke when apiFullName is missing', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', true, createInteractionChannelMock());

		await expect(dispatcher.dispatch({ name: 'api_invoke', arguments: {} })).rejects.toThrow('api_invoke 缺少 apiFullName 参数。');
		expect(enqueueBridgeRequestMock).not.toHaveBeenCalled();
	});

	it('forwards api_index and eda_context to the bridge with normalized payloads', async () => {
		enqueueBridgeRequestMock
			.mockResolvedValueOnce({ ok: true, owner: 'sch' })
			.mockResolvedValueOnce({ ok: true, scope: 'pcb' });

		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', true, createInteractionChannelMock());

		const apiIndexResult = await dispatcher.dispatch({
			name: 'api_index',
			arguments: { owner: ' sch ' },
		});
		const contextResult = await dispatcher.dispatch({
			name: 'eda_context',
			arguments: { scope: ' pcb ', timeoutMs: 3000 },
		});

		expect(enqueueBridgeRequestMock).toHaveBeenNthCalledWith(1, '/bridge/jlceda/api/index', { owner: 'sch' }, 15000);
		expect(enqueueBridgeRequestMock).toHaveBeenNthCalledWith(2, '/bridge/jlceda/context', { scope: 'pcb' }, 3000);
		expect(apiIndexResult).toMatchObject({
			content: [{ type: 'text', text: '{"ok":true,"owner":"sch"}' }],
		});
		expect(contextResult).toMatchObject({
			content: [{ type: 'text', text: '{"ok":true,"scope":"pcb"}' }],
		});
	});

	it('forwards pcb geometry tools to the bridge with normalized payloads', async () => {
		enqueueBridgeRequestMock
			.mockResolvedValueOnce({ ok: true, snapshot: { summary: { objectCounts: { lines: 2 } } } })
			.mockResolvedValueOnce({ ok: true, summary: { featureCount: 3 } })
			.mockResolvedValueOnce({ ok: true, snapshot: { summary: { viaCount: 2 } } });

		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, createInteractionChannelMock());

		const snapshotResult = await dispatcher.dispatch({
			name: 'pcb_snapshot',
			arguments: {
				nets: [' GND ', 'VCC'],
				layerIds: [1, 2],
				include: { lines: true, vias: false },
				timeoutMs: 5000,
			},
		});
		const analyzeResult = await dispatcher.dispatch({
			name: 'pcb_geometry_analyze',
			arguments: {
				tracePrimitiveIds: [' track-1 '],
				spatialObjectKinds: [' region ', 'fill'],
				analysisModes: ['reference_grounding', 'loop_area_proxy'],
				sampleStep: 12,
				includeSnapshot: true,
			},
		});
		const constraintResult = await dispatcher.dispatch({
			name: 'pcb_constraint_snapshot',
			arguments: {
				nets: [' USB_DP '],
				viaPrimitiveIds: [' via-1 '],
				padPrimitiveIds: [' pad-1 '],
				include: { ruleConfiguration: true, vias: true, pads: false },
			},
		});

		expect(enqueueBridgeRequestMock).toHaveBeenNthCalledWith(1, '/bridge/jlceda/pcb/snapshot', {
			nets: ['GND', 'VCC'],
			layerIds: [1, 2],
			include: { lines: true, vias: false },
		}, 5000);
		expect(enqueueBridgeRequestMock).toHaveBeenNthCalledWith(2, '/bridge/jlceda/pcb/geometry/analyze', {
			nets: undefined,
			layerIds: undefined,
			include: undefined,
			tracePrimitiveIds: ['track-1'],
			referenceNetNames: undefined,
			spatialObjectKinds: ['region', 'fill'],
			analysisModes: ['reference_grounding', 'loop_area_proxy'],
			sampleStep: 12,
			includeSnapshot: true,
		}, 15000);
		expect(enqueueBridgeRequestMock).toHaveBeenNthCalledWith(3, '/bridge/jlceda/pcb/constraint/snapshot', {
			nets: ['USB_DP'],
			viaPrimitiveIds: ['via-1'],
			padPrimitiveIds: ['pad-1'],
			include: { ruleConfiguration: true, vias: true, pads: false },
			timeoutMs: 15000,
		}, 15000);
		expect(snapshotResult).toMatchObject({
			isError: false,
		});
		expect(analyzeResult).toMatchObject({
			isError: false,
		});
		expect(constraintResult).toMatchObject({
			isError: false,
		});
	});

	it('dispatches agent decisions without any sidebar calls', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const channel = createInteractionChannelMock();
		const dispatcher = new ToolDispatcher('C:/tmp', 'agent', false, channel);
		for (const [name, path, args] of [
			['component_select', '/bridge/jlceda/component/match', { keyword: 'C123' }],
			['component_place', '/bridge/jlceda/component/place-auto', { components: [{ uuid: 'u', libraryUuid: 'l', x: 10, y: 20 }] }],
			['pin_net_configure', '/bridge/jlceda/schematic/pin-net-configure', { assignments: [] }],
		] as const) {
			enqueueBridgeRequestMock.mockResolvedValueOnce({ ok: true });
			await expect(dispatcher.dispatch({ name, arguments: args })).resolves.toMatchObject({ content: [{ type: 'text', text: '{"ok":true}' }] });
			expect(enqueueBridgeRequestMock).toHaveBeenLastCalledWith(path, name === 'component_select' ? { ...args, limit: 5, page: 1 } : args, expect.any(Number));
		}
		expect(channel.publish).not.toHaveBeenCalled();
		expect(channel.waitForResponse).not.toHaveBeenCalled();
	});
});
