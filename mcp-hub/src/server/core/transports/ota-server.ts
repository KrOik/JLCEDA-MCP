import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Read only explicitly published, content-addressed artifacts. No upload or execution API. */
export function serveOta(req: IncomingMessage, res: ServerResponse, directory: string): boolean {
	if (!req.url?.startsWith('/ota/')) return false;
	const send = (status: number, body: string, type = 'application/json'): void => {
		res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' });
		res.end(body);
	};
	if (req.method !== 'GET') { send(405, '{}'); return true; }
	try {
		if (req.url === '/ota/manifest') {
			const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
			if (manifest.abi !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid manifest');
			const bundle = readFileSync(join(directory, `${manifest.sha256}.js`));
			if (bundle.length > 8000000 || bundle.length !== manifest.bytes || createHash('sha256').update(bundle).digest('hex') !== manifest.sha256) throw new Error('Invalid artifact');
			send(200, JSON.stringify(manifest));
		} else {
			const match = /^\/ota\/bundles\/([a-f0-9]{64})\.js$/.exec(req.url);
			if (!match) { send(404, '{}'); return true; }
			const code = readFileSync(join(directory, `${match[1]}.js`));
			if (code.length > 8000000 || createHash('sha256').update(code).digest('hex') !== match[1]) throw new Error('Invalid artifact');
			send(200, code.toString('utf8'), 'application/javascript');
		}
	} catch { send(404, '{"error":"No valid published OTA artifact"}'); }
	return true;
}
