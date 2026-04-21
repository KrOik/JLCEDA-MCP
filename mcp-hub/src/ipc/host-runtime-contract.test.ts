import { describe, expect, it } from 'vitest';

import { isHostToRuntimeMessage, isRuntimeToHostMessage } from './host-runtime-contract';

describe('host runtime contract guards', () => {
	it('accepts valid host-to-runtime messages', () => {
		expect(isHostToRuntimeMessage({
			type: 'host/sync-settings',
			exposeRawApiTools: true,
			agentInstructions: 'review first',
		})).toBe(true);

		expect(isHostToRuntimeMessage({
			type: 'host/interaction-response',
			response: {
				requestId: 'req-1',
				action: 'cancel',
			},
		})).toBe(true);
	});

	it('accepts valid runtime-to-host messages', () => {
		expect(isRuntimeToHostMessage({
			type: 'runtime/hello',
			sessionId: 'session-a',
			sentAt: new Date().toISOString(),
		})).toBe(true);

		expect(isRuntimeToHostMessage({
			type: 'runtime/interaction',
			request: null,
		})).toBe(true);
	});

	it('rejects malformed IPC messages', () => {
		expect(isHostToRuntimeMessage({
			type: 'host/sync-settings',
			exposeRawApiTools: 'yes',
		})).toBe(false);
		expect(isRuntimeToHostMessage({
			type: 'runtime/status',
			snapshot: {
				runtimeStatus: 'running',
			},
		})).toBe(false);
	});
});
