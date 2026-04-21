import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const REAL_API_DOC_PATH = path.resolve(process.cwd(), 'resources/jlceda-pro-api-doc.json');

let realApiDocText = '';

async function loadHandler() {
	return await import('./api-search-handler');
}

function installApiDocMock(documentText: string) {
	(globalThis as typeof globalThis & { eda?: unknown }).eda = {
		sys_FileSystem: {
			getExtensionFile: vi.fn().mockResolvedValue(
				new File([documentText], 'jlceda-pro-api-doc.json', { type: 'application/json' }),
			),
		},
	};
}

describe('handleApiSearchTask', () => {
	beforeAll(async () => {
		realApiDocText = await readFile(REAL_API_DOC_PATH, 'utf8');
	});

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		installApiDocMock(realApiDocText);
	});

	it('ranks getCurrentSchematicPageInfo ahead of generic sch_Primitive get APIs for natural-language queries', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'get current schematic page info',
			scope: 'callable',
			limit: 50,
		}) as { items: Array<{ fullName: string }> };

		const rankedNames = result.items.map(item => item.fullName);
		const firstGenericPrimitiveGetRank = rankedNames.findIndex(fullName => /^eda\.sch_Primitive.+\.get$/u.test(fullName));

		expect(rankedNames[0]).toBe('eda.dmt_Schematic.getCurrentSchematicPageInfo');
		expect(firstGenericPrimitiveGetRank).toBe(-1);
	});

	it('keeps exact-name lookup stable for getCurrentSchematicPageInfo', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'getCurrentSchematicPageInfo',
			scope: 'callable',
			limit: 5,
		}) as { items: Array<{ fullName: string }>; totalCandidates: number; returnedCount: number };

		expect(result.items[0]?.fullName).toBe('eda.dmt_Schematic.getCurrentSchematicPageInfo');
		expect(result.totalCandidates).toBe(1);
		expect(result.returnedCount).toBe(1);
	});

	it('still honors owner filtering for dmt schematic lookups', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'get current schematic page info',
			scope: 'callable',
			owner: 'dmt',
			limit: 10,
		}) as { items: Array<{ fullName: string; ownerFullName: string }>; totalCandidates: number; returnedCount: number };

		expect(result.items[0]?.fullName).toBe('eda.dmt_Schematic.getCurrentSchematicPageInfo');
		expect(result.totalCandidates).toBe(1);
		expect(result.returnedCount).toBe(1);
		expect(result.items.every(item => item.ownerFullName.toLowerCase().includes('dmt'))).toBe(true);
	});
});
