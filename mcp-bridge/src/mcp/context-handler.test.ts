import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleEdaContextTask } from './context-handler';

interface EdaContextMock {
	dmt_SelectControl: { getCurrentDocumentInfo: ReturnType<typeof vi.fn> };
	dmt_Project: { getCurrentProjectInfo: ReturnType<typeof vi.fn> };
	dmt_Board: { getCurrentBoardInfo: ReturnType<typeof vi.fn> };
	dmt_Schematic: {
		getCurrentSchematicInfo: ReturnType<typeof vi.fn>;
		getCurrentSchematicPageInfo: ReturnType<typeof vi.fn>;
	};
	dmt_Pcb: { getCurrentPcbInfo: ReturnType<typeof vi.fn> };
	dmt_Panel: { getCurrentPanelInfo: ReturnType<typeof vi.fn> };
	pcb_SelectControl: { getAllSelectedPrimitives_PrimitiveId: ReturnType<typeof vi.fn> };
	sch_SelectControl: { getAllSelectedPrimitives_PrimitiveId: ReturnType<typeof vi.fn> };
}

function installEdaContextMock(overrides?: Partial<EdaContextMock>): EdaContextMock {
	const edaMock: EdaContextMock = {
		dmt_SelectControl: {
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ id: 'doc-1', type: 'schematic' }),
		},
		dmt_Project: {
			getCurrentProjectInfo: vi.fn().mockResolvedValue({ id: 'project-1', name: 'Demo Project' }),
		},
		dmt_Board: {
			getCurrentBoardInfo: vi.fn().mockResolvedValue({ id: 'board-1' }),
		},
		dmt_Schematic: {
			getCurrentSchematicInfo: vi.fn().mockResolvedValue({ id: 'sch-1' }),
			getCurrentSchematicPageInfo: vi.fn().mockResolvedValue({ id: 'sch-page-1', title: 'Main' }),
		},
		dmt_Pcb: {
			getCurrentPcbInfo: vi.fn().mockResolvedValue({ id: 'pcb-1', title: 'PCB' }),
		},
		dmt_Panel: {
			getCurrentPanelInfo: vi.fn().mockResolvedValue({ id: 'panel-1' }),
		},
		pcb_SelectControl: {
			getAllSelectedPrimitives_PrimitiveId: vi.fn().mockResolvedValue(['pcb-prim-1']),
		},
		sch_SelectControl: {
			getAllSelectedPrimitives_PrimitiveId: vi.fn().mockResolvedValue(['sch-prim-1', 'sch-prim-2']),
		},
	};

	const merged = {
		...edaMock,
		...overrides,
	};
	(globalThis as typeof globalThis & { eda?: EdaContextMock }).eda = merged;
	return merged;
}

describe('handleEdaContextTask', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installEdaContextMock();
	});

	it('captures current EDA context using reference APIs and preserves the requested scope', async () => {
		const result = await handleEdaContextTask({ scope: ' schematic ' }) as Record<string, unknown>;

		expect(result.scope).toBe('schematic');
		expect(typeof result.capturedAt).toBe('string');
		expect(result.currentDocumentInfo).toEqual({ id: 'doc-1', type: 'schematic' });
		expect(result.currentProjectInfo).toEqual({ id: 'project-1', name: 'Demo Project' });
		expect(result.currentSchematicPageInfo).toEqual({ id: 'sch-page-1', title: 'Main' });
		expect(result.currentPcbInfo).toEqual({ id: 'pcb-1', title: 'PCB' });
		expect(result.selectedPcbPrimitiveIds).toEqual(['pcb-prim-1']);
		expect(result.selectedSchPrimitiveIds).toEqual(['sch-prim-1', 'sch-prim-2']);
	});

	it('falls back to empty selections and undefined snapshots when optional reference APIs fail', async () => {
		installEdaContextMock({
			dmt_Pcb: {
				getCurrentPcbInfo: vi.fn().mockRejectedValue(new Error('pcb unavailable')),
			},
			pcb_SelectControl: {
				getAllSelectedPrimitives_PrimitiveId: vi.fn().mockRejectedValue(new Error('selection unavailable')),
			},
			sch_SelectControl: {
				getAllSelectedPrimitives_PrimitiveId: vi.fn().mockRejectedValue(new Error('selection unavailable')),
			},
		});

		const result = await handleEdaContextTask(null) as Record<string, unknown>;

		expect(result.scope).toBe('');
		expect(result.currentPcbInfo).toBeUndefined();
		expect(result.selectedPcbPrimitiveIds).toEqual([]);
		expect(result.selectedSchPrimitiveIds).toEqual([]);
	});
});
