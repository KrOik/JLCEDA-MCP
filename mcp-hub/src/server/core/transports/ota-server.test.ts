import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { serveOta } from './ota-server';

describe('local OTA distribution', () => {
	it('serves verified immutable code and refuses traversal, corruption and writes', () => {
		const directory = mkdtempSync(join(tmpdir(), 'jlceda-ota-test-'));
		try {
			const code = 'var jlcTaskModule = {};';
			const hash = createHash('sha256').update(code).digest('hex');
			writeFileSync(join(directory, `${hash}.js`), code);
			writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ abi: 1, sha256: hash, bytes: Buffer.byteLength(code) }));
			const request = (url: string, method = 'GET') => {
				let status = 0;
				let body = '';
				const handled = serveOta({ url, method } as IncomingMessage, {
					writeHead: (value: number) => { status = value; }, end: (value: string) => { body = value; },
				} as unknown as ServerResponse, directory);
				return { handled, status, body };
			};
			expect(request('/ota/manifest').status).toBe(200);
			expect(request(`/ota/bundles/${hash}.js`).body).toBe(code);
			expect(request('/ota/bundles/../../manifest.json').status).toBe(404);
			expect(request('/ota/manifest', 'POST').status).toBe(405);
			expect(request('/mcp').handled).toBe(false);
			writeFileSync(join(directory, `${hash}.js`), 'corrupt');
			expect(request('/ota/manifest').status).toBe(404);
			expect(request(`/ota/bundles/${hash}.js`).status).toBe(404);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});
});
