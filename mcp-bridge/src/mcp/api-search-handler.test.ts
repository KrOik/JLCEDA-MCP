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

	it('ranks current rule configuration name ahead of generic getState_Name APIs', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'current rule configuration name',
			scope: 'callable',
			limit: 50,
		}) as { items: Array<{ fullName: string }> };

		expect(result.items[0]?.fullName).toBe('eda.pcb_Drc.getCurrentRuleConfigurationName');
	});

	it('ranks delete schematic page first for delete-schematic-page intent phrasing', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'remove schematic page',
			scope: 'callable',
			limit: 50,
		}) as { items: Array<{ fullName: string }> };

		expect(result.items[0]?.fullName).toBe('eda.dmt_Schematic.deleteSchematicPage');
	});

	it('ranks removeEventListener ahead of isEventListenerAlreadyExist for remove event listener query', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'event listener already exist remove',
			scope: 'callable',
			limit: 50,
		}) as { items: Array<{ fullName: string }> };

		const rankedNames = result.items.map(item => item.fullName);
		const firstRemoveEventListenerIndex = rankedNames.findIndex(fullName => fullName.endsWith('.removeEventListener'));
		const firstAlreadyExistIndex = rankedNames.findIndex(fullName => fullName.endsWith('.isEventListenerAlreadyExist'));
		expect(firstRemoveEventListenerIndex).toBeGreaterThanOrEqual(0);
		expect(firstAlreadyExistIndex).toBeGreaterThanOrEqual(0);
		expect(firstRemoveEventListenerIndex).toBeLessThan(firstAlreadyExistIndex);
	});

	it('keeps current mouse position APIs ahead of schematic current-info APIs under mixed phrasing', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'mouse current schematic info',
			scope: 'callable',
			limit: 50,
		}) as { items: Array<{ fullName: string }> };

		const rankedNames = result.items.map(item => item.fullName);
		const firstMousePositionIndex = rankedNames.findIndex(fullName => fullName.endsWith('.getCurrentMousePosition'));
		const schematicInfoIndex = rankedNames.findIndex(fullName => fullName === 'eda.dmt_Schematic.getCurrentSchematicInfo');
		expect(firstMousePositionIndex).toBeGreaterThanOrEqual(0);
		expect(schematicInfoIndex).toBeGreaterThanOrEqual(0);
		expect(firstMousePositionIndex).toBeLessThan(schematicInfoIndex);
	});

	it('keeps split screen state query ahead of split-screen action APIs', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'split screen',
			scope: 'callable',
			limit: 50,
		}) as { items: Array<{ fullName: string }> };

		const rankedNames = result.items.map(item => item.fullName);
		const splitTreeIndex = rankedNames.findIndex(fullName => fullName === 'eda.dmt_EditorControl.getSplitScreenTree');
		const activateSplitIndex = rankedNames.findIndex(fullName => fullName === 'eda.dmt_EditorControl.activateSplitScreen');
		expect(splitTreeIndex).toBeGreaterThanOrEqual(0);
		expect(activateSplitIndex).toBeGreaterThanOrEqual(0);
		expect(splitTreeIndex).toBeLessThan(activateSplitIndex);
	});

	it('keeps calculating ratline family in stable top ordering', async () => {
		const { handleApiSearchTask } = await loadHandler();
		const result = await handleApiSearchTask({
			query: 'calculating ratline',
			scope: 'callable',
			limit: 10,
		}) as { items: Array<{ fullName: string }> };

		const rankedNames = result.items.map(item => item.fullName);
		const startIndex = rankedNames.findIndex(fullName => fullName === 'eda.pcb_Document.startCalculatingRatline');
		const getStatusIndex = rankedNames.findIndex(fullName => fullName === 'eda.pcb_Document.getCalculatingRatlineStatus');
		expect(startIndex).toBeGreaterThanOrEqual(0);
		expect(getStatusIndex).toBeGreaterThanOrEqual(0);
		expect(startIndex).toBeLessThan(getStatusIndex);
	});
});
