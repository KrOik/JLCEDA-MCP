import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePcbGeometryAnalyzeTask, handlePcbSnapshotTask } from './pcb-geometry-handler';

const { executeMock } = vi.hoisted(() => ({
	executeMock: vi.fn(),
}));

vi.mock('../plugins/plugin-registry.ts', () => {
	return {
		bridgePluginRegistry: {
			execute: executeMock,
		},
	};
});

describe('pcb geometry bridge handlers', () => {
	beforeEach(() => {
		executeMock.mockReset();
	});

	it('delegates snapshot and analyze payloads to the plugin registry', async () => {
		executeMock
			.mockResolvedValueOnce({ ok: true, kind: 'snapshot' })
			.mockResolvedValueOnce({ ok: true, kind: 'analyze' });

		await expect(handlePcbSnapshotTask({ nets: ['GND'] })).resolves.toEqual({ ok: true, kind: 'snapshot' });
		await expect(handlePcbGeometryAnalyzeTask({ analysisModes: ['net_stats'] })).resolves.toEqual({ ok: true, kind: 'analyze' });

		expect(executeMock).toHaveBeenNthCalledWith(1, 'pcb-geometry-engine', 'snapshot', { nets: ['GND'] });
		expect(executeMock).toHaveBeenNthCalledWith(2, 'pcb-geometry-engine', 'analyze', { analysisModes: ['net_stats'] });
	});

	it('rejects non-object payloads before reaching the plugin registry', async () => {
		await expect(handlePcbSnapshotTask('invalid')).rejects.toThrow('pcb/snapshot 任务参数必须为对象。');
		await expect(handlePcbGeometryAnalyzeTask([])).rejects.toThrow('pcb/geometry/analyze 任务参数必须为对象。');
		expect(executeMock).not.toHaveBeenCalled();
	});
});
