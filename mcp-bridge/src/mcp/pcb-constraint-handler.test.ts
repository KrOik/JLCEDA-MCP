import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePcbConstraintSnapshotTask } from './pcb-constraint-handler.ts';

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

describe('pcb constraint bridge handler', () => {
	beforeEach(() => {
		executeMock.mockReset();
	});

	it('delegates snapshot payloads to the plugin registry', async () => {
		executeMock.mockResolvedValueOnce({ ok: true, kind: 'constraint-snapshot' });

		await expect(handlePcbConstraintSnapshotTask({ nets: ['USB_DP'] })).resolves.toEqual({ ok: true, kind: 'constraint-snapshot' });

		expect(executeMock).toHaveBeenCalledWith('pcb-constraint-engine', 'snapshot', { nets: ['USB_DP'] });
	});

	it('rejects non-object payloads before reaching the plugin registry', async () => {
		await expect(handlePcbConstraintSnapshotTask('invalid')).rejects.toThrow('pcb/constraint/snapshot 任务参数必须为对象。');
		expect(executeMock).not.toHaveBeenCalled();
	});
});
