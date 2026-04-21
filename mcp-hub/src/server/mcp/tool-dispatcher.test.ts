import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolDispatcherInteractionChannel } from './tool-dispatcher';

const enqueueBridgeRequestMock = vi.fn();

vi.mock('../bridge/broker', () => {
	return {
		enqueueBridgeRequest: enqueueBridgeRequestMock,
	};
});

describe('ToolDispatcher', () => {
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
			'schematic_read',
			'schematic_review',
			'pcb_snapshot',
			'pcb_geometry_analyze',
			'pcb_constraint_snapshot',
			'component_select',
			'component_place',
		]);
	});

	it('includes passthrough tools when raw API exposure is enabled', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', true, createInteractionChannelMock());

		expect(dispatcher.getToolDefinitions().map((item) => item.name)).toEqual([
			'api_index',
			'api_search',
			'api_invoke',
			'eda_context',
			'schematic_read',
			'schematic_review',
			'pcb_snapshot',
			'pcb_geometry_analyze',
			'pcb_constraint_snapshot',
			'component_select',
			'component_place',
		]);

		dispatcher.updateExposeRawApiTools(false);
		expect(dispatcher.getToolDefinitions()).toHaveLength(7);
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

		await expect(dispatcher.dispatch({ name: 'component_select', arguments: {} })).rejects.toThrow('component_select 缺少 keyword 参数。');
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
			structuredContent: { ok: true, owner: 'sch' },
		});
		expect(contextResult).toMatchObject({
			structuredContent: { ok: true, scope: 'pcb' },
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
		}, 15000);
		expect(snapshotResult).toMatchObject({
			structuredContent: { ok: true },
		});
		expect(analyzeResult).toMatchObject({
			structuredContent: { ok: true },
		});
		expect(constraintResult).toMatchObject({
			structuredContent: { ok: true },
		});
	});

	it('stops component_place before bridge start when the sidebar cancels the interaction', async () => {
		enqueueBridgeRequestMock.mockResolvedValueOnce({
			ok: true,
			placement: {
				title: '原理图器件放置',
				description: '请按顺序放置器件。',
				components: [
					{
						uuid: 'device-1',
						libraryUuid: 'lib-1',
						name: 'STM32F103',
						footprintName: 'LQFP-48',
						subPartName: '',
					},
				],
				timeoutSeconds: 60,
				retryCount: 1,
			},
		});
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const interactionChannel = createInteractionChannelMock();
		interactionChannel.waitForResponse = vi.fn(async (requestId: string, _acceptedActions, _timeoutMs) => ({
			requestId,
			action: 'cancel' as const,
		}));
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, interactionChannel);

		const result = await dispatcher.dispatch({
			name: 'component_place',
			arguments: {
				components: [
					{
						uuid: 'device-1',
						libraryUuid: 'lib-1',
					},
				],
			},
		});

		expect(enqueueBridgeRequestMock).toHaveBeenCalledTimes(1);
		expect(interactionChannel.publish).toHaveBeenCalled();
		expect(result).toMatchObject({
			structuredContent: {
				ok: false,
				errorCode: 'COMPONENT_PLACE_CANCELLED',
				placedCount: 0,
				totalCount: 1,
			},
		});
	});

	it('hard-blocks VCC and GND keywords without opening bridge selection', async () => {
		const { ToolDispatcher } = await import('./tool-dispatcher');
		const interactionChannel = createInteractionChannelMock();
		const dispatcher = new ToolDispatcher('C:\\tmp', 'session-a', false, interactionChannel);

		const vccResult = await dispatcher.dispatch({
			name: 'component_select',
			arguments: { keyword: 'VCC' },
		});
		const gndResult = await dispatcher.dispatch({
			name: 'component_select',
			arguments: { keyword: 'gnd' },
		});

		expect(vccResult).toEqual({
			content: [
				{
					type: 'text',
					text: JSON.stringify({
						ok: false,
						errorCode: 'NET_FLAG_NOT_SELECTABLE',
						message: '电源/地符号（VCC）不需要选型，也不能通过 component_place 放置。电源/地符号需要用户在 EDA 中手动放置。',
					}, null, 2),
				},
			],
			structuredContent: {
				ok: false,
				errorCode: 'NET_FLAG_NOT_SELECTABLE',
				message: '电源/地符号（VCC）不需要选型，也不能通过 component_place 放置。电源/地符号需要用户在 EDA 中手动放置。',
			},
		});
		expect(gndResult).toEqual({
			content: [
				{
					type: 'text',
					text: JSON.stringify({
						ok: false,
						errorCode: 'NET_FLAG_NOT_SELECTABLE',
						message: '电源/地符号（gnd）不需要选型，也不能通过 component_place 放置。电源/地符号需要用户在 EDA 中手动放置。',
					}, null, 2),
				},
			],
			structuredContent: {
				ok: false,
				errorCode: 'NET_FLAG_NOT_SELECTABLE',
				message: '电源/地符号（gnd）不需要选型，也不能通过 component_place 放置。电源/地符号需要用户在 EDA 中手动放置。',
			},
		});
		expect(enqueueBridgeRequestMock).not.toHaveBeenCalled();
		expect(interactionChannel.publish).not.toHaveBeenCalled();
		expect(interactionChannel.waitForResponse).not.toHaveBeenCalled();
		expect(interactionChannel.tryConsumeResponse).not.toHaveBeenCalled();
	});
});
