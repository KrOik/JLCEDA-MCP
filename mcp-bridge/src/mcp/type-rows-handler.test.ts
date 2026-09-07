import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const input = { operationId: 'test-v1', components: [{ key: 'r', uuid: 'a'.repeat(32), libraryUuid: 'b'.repeat(32), designator: 'R901', row: 'resistor', nets: { 1: 'N' } }] };
let storage: Record<string, unknown>;
let createPage: ReturnType<typeof vi.fn>;
beforeEach(() => {
	vi.resetModules(); storage = {};
	createPage = vi.fn(async () => { throw new Error('SDK_WRITE_INTERRUPTED'); });
	vi.stubGlobal('eda', {
		sys_Storage: { getExtensionUserConfig: (k: string) => storage[k], setExtensionUserConfig: vi.fn(async (k: string, v: unknown) => { storage[k] = structuredClone(v); return true; }) },
		dmt_Schematic: { getCurrentSchematicPageInfo: async () => ({ uuid: 'original' }), getCurrentSchematicInfo: async () => ({ uuid: 'schematic' }), createSchematicPage: createPage },
		sch_ManufactureData: { getNetlistFile: async () => ({ text: async () => '{"components":{}}' }) },
	});
});
afterEach(() => vi.unstubAllGlobals());
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
it('returns a job immediately, journals before mutation and refuses replay after uncertainty', async () => {
	const m = await import('./type-rows-handler');
	createPage.mockImplementation(async () => { expect((storage.jlc_mcp_rows_jobs_v1 as any)['test-v1'].pending).toBe('create-page'); throw new Error('SDK_WRITE_INTERRUPTED'); });
	expect(await m.handleTypeRowsTask(input)).toMatchObject({ state: 'running' });
	await flush();
	const status = await m.handleTypeRowsTask({ operationId: 'test-v1', action: 'status' });
	expect(status).toMatchObject({ state: 'uncertain', pending: 'create-page' });
	expect(m.rowsWriteBlocked()).toBe(true);
	await m.handleTypeRowsTask(input);
	expect(createPage).toHaveBeenCalledTimes(1);
	await expect(m.handleTypeRowsTask({ ...input, components: [{ ...input.components[0], designator: 'R902' }] })).rejects.toThrow('OPERATION_ID_CONFLICT');
});
it('retains read-only status across module reload and never resumes a pending write', async () => {
	const m = await import('./type-rows-handler');
	await m.handleTypeRowsTask(input); await flush();
	vi.resetModules(); const reloaded = await import('./type-rows-handler');
	expect(await reloaded.handleTypeRowsTask({ operationId: 'test-v1', action: 'status' })).toMatchObject({ state: 'uncertain' });
	expect(reloaded.rowsWriteBlocked()).toBe(true);
	expect(createPage).toHaveBeenCalledTimes(1);
});
it('rejects duplicate keys/designators before page writes', async () => {
	const m = await import('./type-rows-handler');
	await expect(m.handleTypeRowsTask({ ...input, components: [input.components[0], input.components[0]] })).rejects.toThrow('DUPLICATE_KEY');
	await expect(m.handleTypeRowsTask({ ...input, components: [input.components[0], { ...input.components[0], key: 'other' }] })).rejects.toThrow('DESIGNATOR_CONFLICT');
	expect(createPage).not.toHaveBeenCalled();
});
it('does not create anything when persistence fails', async () => {
	vi.mocked(eda.sys_Storage.setExtensionUserConfig).mockResolvedValue(false);
	const m = await import('./type-rows-handler');
	await expect(m.handleTypeRowsTask(input)).rejects.toThrow('JOURNAL_WRITE_FAILED');
	expect(createPage).not.toHaveBeenCalled(); expect(m.isRowsIdle()).toBe(true);
});
it('allows status while SDK work is pending and blocks another job', async () => {
	createPage.mockImplementation(() => new Promise(() => {}));
	const m = await import('./type-rows-handler');
	await m.handleTypeRowsTask(input); await flush();
	expect(await m.handleTypeRowsTask({ operationId: 'test-v1', action: 'status' })).toMatchObject({ pending: 'create-page' });
	expect((await m.handleTypeRowsTask({ ...input, operationId: 'test-v2' })).error).toBe('ROWS_JOB_OWNS_WRITES');
	expect(m.isRowsIdle()).toBe(false);
});
