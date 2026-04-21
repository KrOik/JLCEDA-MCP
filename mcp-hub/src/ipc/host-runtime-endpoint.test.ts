import { describe, expect, it } from 'vitest';

import { createHostRuntimeIpcEndpoint } from './host-runtime-endpoint';

describe('host runtime endpoint', () => {
	it('creates a deterministic and sanitized endpoint for the current platform', () => {
		const endpoint = createHostRuntimeIpcEndpoint('session with / unsafe:*? chars', 'C:/workspace/jlceda-mcp');

		if (process.platform === 'win32') {
			expect(endpoint).toMatch(/^\\\\\.\\pipe\\jlceda-mcp-host-session_with_unsafe_chars-[a-f0-9]{12}$/);
			return;
		}

		expect(endpoint).toMatch(/jlceda-mcp-host-session_with_unsafe_chars-[a-f0-9]{12}\.sock$/);
	});

	it('changes the endpoint when the storage scope changes', () => {
		const endpointA = createHostRuntimeIpcEndpoint('shared-session', 'C:/workspace/a');
		const endpointB = createHostRuntimeIpcEndpoint('shared-session', 'C:/workspace/b');

		expect(endpointA).not.toBe(endpointB);
	});
});
