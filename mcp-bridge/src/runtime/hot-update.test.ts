import { webcrypto, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotUpdateManager } from './hot-update';

const code = 'var jlcTaskModule = {abi:1,isIdle:()=>true, handlers:{test:async()=>"new"},setExecutionDeadline:()=>{}};';
const sha256 = createHash('sha256').update(code).digest('hex');
const bundled = { abi: 1, isIdle: () => true, handlers: { test: async () => 'old' }, setExecutionDeadline: () => {} };
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
	vi.stubGlobal('crypto', webcrypto);
	request = vi.fn(async (url: string) => new Response(url.endsWith('/manifest') ? JSON.stringify({ abi: 1, sha256, bytes: code.length }) : code));
	vi.stubGlobal('eda', { sys_Storage: { getExtensionUserConfig: () => undefined }, sys_ClientUrl: { request } });
});
afterEach(() => vi.unstubAllGlobals());

describe('OTA task-module transaction', () => {
	it('defers update while an interactive placement session is open', async () => {
		const manager = new HotUpdateManager({ ...bundled, isIdle: () => false }, () => false);
		await manager.check();
		expect(request).not.toHaveBeenCalled();
	});
	it('rejects a hash-valid module with a broken contract', async () => {
		const broken = 'var jlcTaskModule = {abi:1};';
		const hash = createHash('sha256').update(broken).digest('hex');
		request.mockImplementation(async (url: string) => new Response(url.endsWith('/manifest') ? JSON.stringify({ abi: 1, sha256: hash, bytes: broken.length }) : broken));
		const manager = new HotUpdateManager(bundled, () => false);
		await manager.check();
		expect(manager.current).toBe(bundled);
		expect(manager.status.error).toContain('contract');
	});
	it('confirms replacement and rolls back without reexecuting tasks', async () => {
		const manager = new HotUpdateManager(bundled, () => false);
		await manager.check();
		expect(manager.status.state).toBe('confirmed');
		expect(await manager.current.handlers.test(undefined)).toBe('new');
		expect(manager.rollback()).toBe(true);
		await manager.check();
		expect(manager.current).toBe(bundled);
	});
	it('does not download or replace during a running EDA call', async () => {
		const manager = new HotUpdateManager(bundled, () => true);
		await manager.check();
		expect(request).not.toHaveBeenCalled();
		expect(manager.current).toBe(bundled);
	});
	it('rechecks busy state after download', async () => {
		let busy = false;
		const original = request.getMockImplementation()!;
		request.mockImplementation(async (url: string) => { const result = await original(url); if (url.endsWith('.js')) busy = true; return result; });
		const manager = new HotUpdateManager(bundled, () => busy);
		await manager.check();
		expect(manager.current).toBe(bundled);
	});
	it('rejects tampered content and preserves the working module', async () => {
		request.mockImplementation(async (url: string) => new Response(url.endsWith('/manifest') ? JSON.stringify({ abi: 1, sha256: '0'.repeat(64), bytes: code.length }) : code));
		const manager = new HotUpdateManager(bundled, () => false);
		await manager.check();
		expect(manager.status.error).toContain('checksum');
		expect(manager.current).toBe(bundled);
	});
	it('does not activate a download completed after unload', async () => {
		const manager = new HotUpdateManager(bundled, () => false);
		const original = request.getMockImplementation()!;
		request.mockImplementation(async (url: string) => { const result = await original(url); manager.stop(); return result; });
		await manager.check();
		expect(manager.current).toBe(bundled);
	});
	it('refuses an arbitrary remote code origin', async () => {
		vi.stubGlobal('eda', { sys_Storage: { getExtensionUserConfig: () => 'https://example.com' }, sys_ClientUrl: { request } });
		const manager = new HotUpdateManager(bundled, () => false);
		await manager.check();
		expect(request).not.toHaveBeenCalled();
		expect(manager.status.state).toBe('failed');
	});
});
