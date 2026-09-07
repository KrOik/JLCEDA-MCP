import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { outerLabelCandidates, chooseOuterLabelBox, placeOuterNetLabels } from './outer-net-labels';
const mocks = vi.hoisted(() => ({ attrs: vi.fn(), position: vi.fn(), obstacles: vi.fn() }));
vi.mock('./native-attributes', () => ({ readNativeAttributes: mocks.attrs, positionNativeAttribute: mocks.position }));
vi.mock('./layout-safety', async importOriginal => ({ ...await importOriginal<typeof import('./layout-safety')>(), readObstacles: mocks.obstacles }));
vi.mock('./schematic-wire-reader', async importOriginal => ({ ...await importOriginal<typeof import('./schematic-wire-reader')>(), readNativeWireObstacles: async () => [] }));
beforeEach(() => {
	vi.clearAllMocks();
	mocks.obstacles.mockResolvedValue([]);
	mocks.attrs.mockResolvedValue([{ id: 'label', key: 'NET', parent: 'wire', native: { getState_Value: () => 'N' }, box: { minX: 0, maxX: 10, minY: 0, maxY: 10 } }]);
	mocks.position.mockImplementation(async (_id, box) => box);
	vi.stubGlobal('eda', { sch_PrimitiveWire: { get: vi.fn(async () => ({ getState_Net: () => 'N', getState_Line: () => [0, 0, 100, 0] })) } });
});
afterEach(() => vi.unstubAllGlobals());
it.each([[0, 0, 100, 0], [0, 0, -100, 0], [0, 0, 0, 100], [0, 0, 0, -100]])('reserves two independent outer-side regions for %j', (...line: number[]) => {
	const boxes = outerLabelCandidates(line, 40);
	expect(boxes).toHaveLength(2);
	for (const box of boxes) expect((box.maxX - box.minX) * (box.maxY - box.minY)).toBe(400);
	expect(boxes[0]).not.toEqual(boxes[1]);
});
it('uses the opposite side if the first region is occupied; rejects both occupied', () => {
	const line = [0, 0, 100, 0], [first, second] = outerLabelCandidates(line, 40);
	expect(chooseOuterLabelBox(line, 40, [{ id: 'obstacle', box: first }])).toEqual(second);
	expect(() => chooseOuterLabelBox(line, 40, [{ id: 'a', box: first }, { id: 'b', box: second }])).toThrow('LABEL_COLLISION');
});
it('rejects too-short or non-orthogonal final segments', () => {
	expect(() => outerLabelCandidates([0, 0, 20, 0], 40)).toThrow('LABEL_LEAD_TOO_SHORT');
	expect(() => outerLabelCandidates([0, 0, 100, 100], 40)).toThrow('INVALID_FINAL_SEGMENT');
});
it('positions only the exact native NET attribute and returns measured evidence', async () => {
	const line = [0, 0, 100, 0], target = outerLabelCandidates(line, 40)[0];
	const check = vi.fn(async () => {});
	expect(await placeOuterNetLabels('page', [{ primitiveId: 'wire', netName: 'N', line, target }], check)).toEqual([{ primitiveId: 'wire', attributeId: 'label', box: target }]);
	expect(mocks.position).toHaveBeenCalledWith('label', target, check, 10, 0);
});
it('does not move ambiguous, missing or wrong-parent labels', async () => {
	mocks.attrs.mockResolvedValue([{ id: 'unrelated', key: 'NET', parent: 'other-wire', native: { getState_Value: () => 'N' } }]);
	await expect(placeOuterNetLabels('page', [{ primitiveId: 'wire', netName: 'N', line: [0, 0, 100, 0], target: outerLabelCandidates([0, 0, 100, 0], 40)[0] }], async () => {})).rejects.toThrow('NET_LABEL_UNAVAILABLE');
	expect(mocks.position).not.toHaveBeenCalled();
});
it('fails if real native text cannot fit the reserved region', async () => {
	mocks.position.mockRejectedValue(new Error('TEXT_EXCEEDS_ENVELOPE'));
	await expect(placeOuterNetLabels('page', [{ primitiveId: 'wire', netName: 'N', line: [0, 0, 100, 0], target: outerLabelCandidates([0, 0, 100, 0], 40)[0] }], async () => {})).rejects.toThrow('TEXT_EXCEEDS_ENVELOPE');
});
