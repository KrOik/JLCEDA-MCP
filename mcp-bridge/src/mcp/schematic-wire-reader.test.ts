import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSchematicWires } from './schematic-wire-reader';

const wire = (id: string) => ({ getState_PrimitiveId: () => id });
function setup(count = 82, sourcePage = 'p1') {
	const ids = Array.from({ length: count }, (_, i) => `w${i}`);
	const get = vi.fn(async (batch: string[]) => batch.map(wire));
	const source = [`{"type":"DOCHEAD"}||{"uuid":"${sourcePage}"}|`, ...ids.map(id => `{"type":"WIRE","id":"${id}"}||{"zIndex":1}|`)].join('\n');
	const sourceReader = vi.fn(async () => source);
	vi.stubGlobal('eda', {
		sch_PrimitiveWire: { getAll: async () => [], getAllPrimitiveId: async () => [...ids, 'phantom'], get },
		dmt_Schematic: { getCurrentSchematicPageInfo: async () => ({ uuid: 'p1' }) },
		sys_FileManager: { getDocumentSource: sourceReader },
	});
	return { ids, get, sourceReader };
}
afterEach(() => vi.unstubAllGlobals());
describe('wire index recovery', () => {
	it('recovers live wires without accepting phantom indexed IDs as geometry', async () => {
		const { ids, get } = setup();
		expect((await readSchematicWires()).map(w => w.getState_PrimitiveId())).toEqual(ids);
		expect(get.mock.calls.map(([batch]) => batch.length)).toEqual([50, 32]);
	});
	it('rejects a partial native read instead of silently dropping obstacles', async () => {
		const { get } = setup();
		get.mockResolvedValueOnce([]);
		await expect(readSchematicWires()).rejects.toThrow('GEOMETRY_UNAVAILABLE');
	});
	it('rejects source from another page before resolving primitive IDs', async () => {
		const { get } = setup(2, 'p2');
		await expect(readSchematicWires()).rejects.toThrow('DOCUMENT_CHANGED');
		expect(get).not.toHaveBeenCalled();
	});
	it('keeps the fast path when the SDK membership is consistent', async () => {
		const { sourceReader } = setup();
		(eda.sch_PrimitiveWire.getAll as any) = async () => [wire('a')];
		(eda.sch_PrimitiveWire.getAllPrimitiveId as any) = async () => ['a'];
		expect(await readSchematicWires()).toHaveLength(1);
		expect(sourceReader).not.toHaveBeenCalled();
	});
	it('accepts an empty source only when its page identity is verified', async () => {
		setup(0);
		expect(await readSchematicWires()).toEqual([]);
	});
});
