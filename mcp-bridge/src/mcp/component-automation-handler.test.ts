import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setExecutionDeadline } from '../runtime/execution-guard';
import { toSerializableAsync } from '../utils';
import { handleComponentPlaceAutoTask as placeAuto, handlePinNetConfigureTask } from './component-automation-handler';
import { overlaps, pointOnWire, readObstacles, readComponentGeometry, validBox } from './layout-safety';

const placed = new Map<string, { x: number; y: number; designator?: string; uniqueId?: string }>();
const netWires = new Map<string, { x: number; y: number; net: string; line: number[] }>();
function pin(x: number, y: number, pinNumber = '1') {
	return {
		getState_X: () => x,
		getState_Y: () => y,
		getState_PinNumber: () => pinNumber,
		getState_NoConnected: () => false,
	};
}
function primitive(id: string, x: number, y: number) {
	return {
		getState_PrimitiveId: () => id,
		getState_ComponentType: () => 'part',
		getState_X: () => x,
		getState_Y: () => y,
		getState_Net: () => '',
		getState_Designator: () => placed.get(id)?.designator ?? 'R?',
		getState_UniqueId: () => placed.get(id)?.uniqueId ?? '',
	};
}
const create = vi.fn(async (_device, x: number, y: number) => {
	const id = `new-${placed.size}`;
	placed.set(id, { x, y });
	return primitive(id, x, y);
});
const remove = vi.fn(async (id: string) => placed.delete(id) || netWires.delete(id));
const modify = vi.fn(async (id: string, position: { x: number; y: number }) => {
	if (netWires.has(id)) return primitive(id, netWires.get(id)!.x, netWires.get(id)!.y);
	placed.set(id, { ...placed.get(id)!, ...position });
	return primitive(id, position.x, position.y);
});
const getPins = vi.fn(async (id: string) => {
	const position = placed.get(id) ?? { x: 0, y: 0 };
	return [pin(position.x, position.y)];
});
const getWires = vi.fn(async (): Promise<unknown[]> => []);
const getComponents = vi.fn(async () => [...placed.entries()].map(([id, p]) => primitive(id, p.x, p.y)));
const createWire = vi.fn(async (line: number[], net: string) => {
	const id = `net-${netWires.size}`;
	netWires.set(id, { x: line[0], y: line[1], net, line });
	return { getState_PrimitiveId: () => id, getState_Net: () => net, getState_Line: () => line };
});
const getWire = vi.fn(async (id: string) => {
	const wire = netWires.get(id)!;
	return { getState_Net: (): string => wire.net, getState_Line: (): number[] => wire.line };
});

beforeEach(() => {
	vi.clearAllMocks();
	placed.clear();
	netWires.clear();
	setExecutionDeadline(undefined);
	getWires.mockResolvedValue([]);
	getComponents.mockImplementation(async () => [...placed.entries()].map(([id, p]) => primitive(id, p.x, p.y)));
	getPins.mockImplementation(async (id: string) => {
		const position = placed.get(id) ?? netWires.get(id) ?? { x: 0, y: 0 };
		return [pin(position.x, position.y)];
	});
	vi.stubGlobal('eda', {
		sch_Drc: { check: vi.fn(async () => true) },
		sch_ManufactureData: { getNetlistFile: async () => ({ text: async () => JSON.stringify({
			components: Object.fromEntries([...placed].map(([id, position]) => [position.uniqueId || id, {
				pinInfoMap: { '1': { net: [...netWires.values()].find(port => port.x === position.x && port.y === position.y)?.net ?? 'VCC' } },
			}])),
		}) }) },
		dmt_Schematic: { getCurrentSchematicPageInfo: async () => ({ uuid: 'page' }) },
		sch_PrimitiveComponent: {
			create,
			createNetPort: vi.fn(),
			createNetFlag: vi.fn(),
			modify,
			delete: remove,
			getAllPinsByPrimitiveId: getPins,
		getAll: getComponents,
			get: async (id: string) => {
				if (netWires.has(id)) return getWire(id);
				const p = placed.get(id);
				return p && primitive(id, p.x, p.y);
			},
		},
		sch_PrimitiveWire: { getAll: getWires, create: createWire, get: getWire, delete: remove },
		sch_PrimitiveAttribute: { getAll: async () => [], createNetLabel: vi.fn(), get: vi.fn() },
		sch_Primitive: { getPrimitivesBBox: async ([id]: string[]) => {
			const p = placed.get(id);
			return p && { minX: p.x - 20, maxX: p.x + 20, minY: p.y - 20, maxY: p.y + 20 };
		} },
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	setExecutionDeadline(undefined);
});
const device = { uuid: 'device', libraryUuid: 'library' };

it.each(['grid', 'compact', 'elk'])('preserves requested designators in %s and rejects conflicts before mutation', async mode => {
	const result = await placeAuto({ components: [{ ...device, designator: 'C6' }], layout: { mode } }) as any;
	expect(result).toMatchObject({ ok: true, results: [{ designator: 'C6', executionState: 'confirmed' }] });
	create.mockClear();
	await expect(placeAuto({ components: [{ ...device, designator: 'c6' }], layout: { mode } })).rejects.toThrow('DESIGNATOR_CONFLICT');
	expect(create).not.toHaveBeenCalled();
});

it.each([null, false, undefined, true])('does not union metadata or empty rendered text origin boxes into a remote part (%s)', async visibility => {
	placed.set('existing', { x: 400000, y: -300000 });
	const bbox = eda.sch_Primitive.getPrimitivesBBox;
	eda.sch_Primitive.getPrimitivesBBox = vi.fn(async (ids: any) => ids[0] === 'metadata'
		? { minX: 0, maxX: 0, minY: 0, maxY: 0 } : bbox(ids));
	(eda.sch_PrimitiveAttribute.getAll as any) = async () => [{
		getState_PrimitiveId: () => 'metadata', getState_ParentPrimitiveId: () => 'existing',
		getState_KeyVisible: () => visibility, getState_ValueVisible: () => visibility,
	}];
	const geometry = await readComponentGeometry(primitive('existing', 400000, -300000), 'existing');
	expect(geometry.box).toEqual({ minX: 399980, maxX: 400020, minY: -300020, maxY: -299980 });
	expect(geometry.measured).toBe(true);
});
// Preserve legacy grid regression coverage separately from the new default layout.
const handleComponentPlaceAutoTask = (args: any) => placeAuto({ ...args, layout: { mode: 'grid', ...args.layout } });

describe('agent placement execution feedback', () => {
	it('reserves grid lead space before moving a staged part', async () => {
		placed.set('existing', { x: 90, y: 15 });
		const result = await handleComponentPlaceAutoTask({ components: [{ ...device, x: 0, y: 0, nets: { '1': 'VCC' } }] });
		expect(result).toMatchObject({ ok: false, results: [{ cleanedUp: true, error: expect.stringContaining('LAYOUT_COLLISION') }] });
		expect(modify).not.toHaveBeenCalled();
		expect(createWire).not.toHaveBeenCalled();
	});
	it('uses the requested grid lead length for both reservation and writing', async () => {
		const result = await handleComponentPlaceAutoTask({ components: [{ ...device, nets: { '1': 'VCC' } }], layout: { leadLength: 40 } });
		expect(result).toMatchObject({ ok: true });
		expect(createWire).toHaveBeenCalledWith([0, 0, 40, 0], 'VCC', null, null, null);
	});
	it('places all parts before connecting their requested nets', async () => {
		expect(await handleComponentPlaceAutoTask({ components: [
			{ ...device, nets: { '1': '3V3' } }, { ...device, nets: { '1': 'GND' } },
		] })).toMatchObject({ ok: true, remainingIndices: [], connections: { ok: true, attempted: 2 } });
		expect(Math.max(...modify.mock.invocationCallOrder)).toBeLessThan(Math.min(...createWire.mock.invocationCallOrder));
		expect(eda.sch_PrimitiveComponent.createNetPort).not.toHaveBeenCalled();
		expect(eda.sch_PrimitiveComponent.createNetFlag).not.toHaveBeenCalled();
	});
	it('accepts a state snapshot array returned by component create during compact layout', async () => {
		create.mockImplementationOnce(async (_device, x: number, y: number) => {
			placed.set('snapshot-part', { x, y });
			return [{ primitiveId: 'snapshot-part', designator: 'R?' }] as any;
		});
		expect(await placeAuto({ components: [device] })).toMatchObject({
			ok: true,
			mode: 'compact',
			results: [{ primitiveId: 'snapshot-part', ok: true }],
		});
	});
	it('validates net mappings before any placement', async () => {
		await expect(handleComponentPlaceAutoTask({ components: [{ ...device, nets: { '1': '' } }] })).rejects.toThrow('netName');
		expect(create).not.toHaveBeenCalled();
	});
	it('preserves placed parts when connection fails and exposes a native escape hatch', async () => {
		createWire.mockResolvedValueOnce(undefined as any);
		const result = await handleComponentPlaceAutoTask({ components: [{ ...device, nets: { '1': '3V3' } }] });
		expect(result)
			.toMatchObject({ ok: false, remainingIndices: [], connections: { ok: false, escapeHatch: { apiFullName: 'eda.sch_PrimitiveWire.create' } } });
		expect(await toSerializableAsync(result)).toMatchObject({ escapeHatch: { args: [[0, 0, 80, 0], '3V3', null, null, null] } });
		expect(placed.size).toBe(1);
		expect(createWire).toHaveBeenCalledTimes(1);
	});
	it('places a default batch when the SDK omits all bounding boxes', async () => {
		(eda.sch_Primitive.getPrimitivesBBox as any) = async () => undefined;
		const result = await handleComponentPlaceAutoTask({ components: Array.from({ length: 5 }, () => device) });
		expect(result).toMatchObject({ ok: true, attempted: 5, remainingIndices: [] });
	});
	it('reports the completed prefix and untouched suffix after a collision', async () => {
		placed.set('existing', { x: 1000, y: 0 });
		const result = await handleComponentPlaceAutoTask({ components: [
			{ ...device, x: 0, y: 0 }, { ...device, x: 1000, y: 0 }, { ...device, x: 2000, y: 0 },
		] });
		expect(result).toMatchObject({ ok: false, attempted: 2, remainingIndices: [1, 2] });
		expect(result).toMatchObject({ results: [{ ok: true }, { suggestedPosition: { x: expect.any(Number), y: expect.any(Number) } }] });
		expect(create).toHaveBeenCalledTimes(2);
		expect(modify).toHaveBeenCalledTimes(1);
	});
	it('requires readback when a created component cannot be confirmed', async () => {
		(eda.sch_PrimitiveComponent.get as any) = async () => undefined;
		expect(await handleComponentPlaceAutoTask({ components: [device, device] })).toMatchObject({
			ok: false, remainingIndices: [0, 1],
		});
		expect(create).toHaveBeenCalledTimes(1);
		expect(remove).not.toHaveBeenCalled();
	});
	it('ignores non-part schematic objects whose SDK geometry is unavailable', async () => {
		getComponents.mockImplementation(async (type?: string) => type === 'part'
			? [primitive('part', 0, 0)]
			: [primitive('part', 0, 0), primitive('title-block', 0, 0)]);
		placed.set('part', { x: 0, y: 0 });
		await expect(readObstacles()).resolves.toEqual([{ id: 'part', box: { minX: -20, maxX: 20, minY: -20, maxY: 20 } }]);
		expect(getComponents).toHaveBeenCalledWith('part', false);
	});
	it('uses a conservative anchor envelope when this EDA API omits a physical part BBox', async () => {
		getComponents.mockResolvedValue([primitive('missing-geometry', 0, 0)]);
		await expect(readObstacles()).resolves.toEqual([{ id: 'missing-geometry', box: { minX: -250, maxX: 250, minY: -250, maxY: 250 } }]);
	});
	it('validates the whole batch before writing', async () => {
		await expect(handleComponentPlaceAutoTask({ components: [device, { ...device, rotation: 45 }] })).rejects.toThrow('rotation');
		expect(create).not.toHaveBeenCalled();
	});
	it('rejects duplicate planned coordinates before writing', async () => {
		await expect(handleComponentPlaceAutoTask({ components: [{ ...device, x: 1, y: 1 }, { ...device, x: 1, y: 1 }] })).rejects.toThrow('LAYOUT_COLLISION');
		expect(create).not.toHaveBeenCalled();
	});
	it('stages, checks real geometry, moves and confirms placement by rereading', async () => {
		const result = await handleComponentPlaceAutoTask({ components: [device, device] });
		expect(result).toMatchObject({ ok: true, results: [{ primitiveId: 'new-0', executionState: 'confirmed' }, { primitiveId: 'new-1', executionState: 'confirmed' }] });
		expect(create.mock.calls[0][1]).toBe(20000);
		expect(modify).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ results: [{ designator: 'R1', uniqueId: 'new-0' }, { designator: 'R2', uniqueId: 'new-1' }] });
	});
	it('allocates a free designator without renumbering existing parts', async () => {
		placed.set('existing', { x: -1000, y: 0, designator: 'R1', uniqueId: 'keep-me' });
		expect(await handleComponentPlaceAutoTask({ components: [device] })).toMatchObject({ results: [{ designator: 'R2' }] });
		expect(placed.get('existing')).toMatchObject({ designator: 'R1', uniqueId: 'keep-me' });
	});
	it('confirms placement when the installed API returns a plain state snapshot', async () => {
		(eda.sch_PrimitiveComponent.get as any) = async (id: string) => {
			const position = placed.get(id);
			return position && { ...position };
		};
		expect(await handleComponentPlaceAutoTask({ components: [device] })).toMatchObject({ ok: true, results: [{ executionState: 'confirmed' }] });
	});
	it('confirms placement when the installed API wraps one state snapshot in an array', async () => {
		(eda.sch_PrimitiveComponent.get as any) = async (id: string) => {
			const position = placed.get(id);
			return position && [{ ...position }];
		};
		expect(await handleComponentPlaceAutoTask({ components: [device] })).toMatchObject({ ok: true, results: [{ executionState: 'confirmed' }] });
	});
	it('rejects overlap with an existing component and only removes its own staged object', async () => {
		placed.set('existing', { x: 0, y: 0 });
		expect(await handleComponentPlaceAutoTask({ components: [device] })).toMatchObject({ ok: false, results: [{ cleanedUp: true, error: expect.stringContaining('LAYOUT_COLLISION') }] });
		expect(placed.has('existing')).toBe(true);
		expect(modify).not.toHaveBeenCalled();
	});
	it('dryRun never creates a probe component', async () => {
		expect(await handleComponentPlaceAutoTask({ components: [device], dryRun: true })).toMatchObject({ geometryVerified: false });
		expect(create).not.toHaveBeenCalled();
	});
	it('an expired task cannot start another write', async () => {
		setExecutionDeadline(Date.now() - 1);
		expect(await handleComponentPlaceAutoTask({ components: [device] })).toMatchObject({ ok: false });
		expect(create).not.toHaveBeenCalled();
	});
});

describe('measured compact and ELK placement execution', () => {
	it.each(['compact', 'elk'])('stages the entire batch, packs measured bounds, then verifies %s writes', async mode => {
		const result = await placeAuto({ components: [{ ...device, group: 'reset' }, { ...device, group: 'reset' }], layout: { mode } }) as any;
		expect(result).toMatchObject({ ok: true, remainingIndices: [], mode, results: [{ geometry: { source: 'sdk-bbox', width: 40, height: 40 } }, { geometry: { source: 'sdk-bbox' } }] });
		const [a, b] = result.results;
		expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(300);
		expect(placed.size).toBe(2);
	});
	it('defaults to compact without explicit positions and connects only after placement', async () => {
		const result = await placeAuto({ components: [{ ...device, nets: { '1': 'VCC' } }] });
		expect(result).toMatchObject({ ok: true, mode: 'compact', connections: { ok: true } });
		expect(Math.max(...modify.mock.invocationCallOrder)).toBeLessThan(Math.min(...createWire.mock.invocationCallOrder));
	});
	it.each([undefined, 60])('uses the same compact lead length for reserved geometry and actual wiring (%s)', async leadLength => {
		const result = await placeAuto({ components: [{ ...device, nets: { '1': 'VCC' } }], layout: { leadLength } }) as any;
		expect(result.ok).toBe(true);
		const line = result.connections.results[0].line;
		expect(Math.hypot(line[2] - line[0], line[3] - line[1])).toBe(leadLength ?? 40);
		const envelope = result.results[0].geometry.placementEnvelope;
		for (let i = 0; i < line.length; i += 2) {
			expect(line[i]).toBeGreaterThanOrEqual(envelope.minX);
			expect(line[i]).toBeLessThanOrEqual(envelope.maxX);
			expect(line[i + 1]).toBeGreaterThanOrEqual(envelope.minY);
			expect(line[i + 1]).toBeLessThanOrEqual(envelope.maxY);
		}
	});
	it.each([0, 29, 1001, NaN])('rejects invalid compact lead length %s before creating parts', async leadLength => {
		await expect(placeAuto({ components: [device], layout: { leadLength } })).rejects.toThrow();
		expect(create).not.toHaveBeenCalled();
	});
	it('normalizes real SDK inverted Y coordinates and includes distant pin endpoints', async () => {
		(eda.sch_Primitive.getPrimitivesBBox as any) = async ([id]: string[]) => {
			const p = placed.get(id)!;
			return { minX: p.x - 5.5, maxX: p.x + 5.5, minY: p.y + 8.5, maxY: p.y - 8.5 };
		};
		getPins.mockImplementation(async id => { const p = placed.get(id)!; return [pin(p.x - 20, p.y), pin(p.x + 20, p.y, '2')]; });
		expect(await placeAuto({ components: [device] })).toMatchObject({ ok: true, results: [{ geometry: { source: 'sdk-bbox', width: 40, height: 17 } }] });
	});
	it('cleans probes when actual dimensions are unavailable instead of claiming a verified layout', async () => {
		(eda.sch_Primitive.getPrimitivesBBox as any) = async () => undefined;
		expect(await placeAuto({ components: [device, device] })).toMatchObject({ ok: false, error: expect.stringContaining('GEOMETRY_UNAVAILABLE'), cleanup: [{ deleted: true }], remainingIndices: [0, 1] });
		expect(placed.size).toBe(0);
	});
	it('includes visible attribute bounds in measured component dimensions', async () => {
		const attribute = { getState_PrimitiveId: () => 'attr', getState_ParentPrimitiveId: () => 'new-0', getState_KeyVisible: () => false, getState_ValueVisible: () => true };
		(eda.sch_PrimitiveAttribute.getAll as any) = async () => [attribute];
		(eda.sch_Primitive.getPrimitivesBBox as any) = async ([id]: string[]) => {
			const p = placed.get('new-0')!;
			return id === 'attr'
				? { minX: p.x + 25, maxX: p.x + 125, minY: p.y - 5, maxY: p.y + 5 }
				: { minX: p.x - 20, maxX: p.x + 20, minY: p.y + 20, maxY: p.y - 20 };
		};
		expect(await placeAuto({ components: [device] })).toMatchObject({ ok: true, results: [{ geometry: { width: 145 } }] });
	});
	it('preserves SDK world-space bounds for a rotated and mirrored symbol', async () => {
		(eda.sch_Primitive.getPrimitivesBBox as any) = async ([id]: string[]) => {
			const p = placed.get(id)!;
			return { minX: p.x - 8.5, maxX: p.x + 8.5, minY: p.y + 5.5, maxY: p.y - 5.5 };
		};
		expect(await placeAuto({ components: [{ ...device, rotation: 90, mirror: true }] })).toMatchObject({ ok: true, results: [{ geometry: { width: 17, height: 11 } }] });
		expect(create).toHaveBeenCalledWith(expect.anything(), expect.any(Number), expect.any(Number), undefined, 90, true, true, true);
	});
	it('preserves an unconfirmed final write and cleans only untouched staged parts', async () => {
		(eda.sch_PrimitiveComponent.get as any) = async () => undefined;
		const result = await placeAuto({ components: [device, device] });
		expect(result).toMatchObject({ ok: false, unconfirmedPrimitiveIds: ['new-0'], cleanup: [{ primitiveId: 'new-1', deleted: true }], remainingIndices: [0, 1] });
		expect(placed.has('new-0')).toBe(true);
	});
	it('validates unsupported mixing and invalid bounds before mutations', async () => {
		await expect(placeAuto({ components: [{ ...device, x: 0 }], layout: { mode: 'elk' } })).rejects.toThrow('x/y');
		await expect(placeAuto({ components: [device], layout: { grid: 0 } })).rejects.toThrow('布局约束非法');
		await expect(placeAuto({ components: [device], layout: { mode: 'unknown' } })).rejects.toThrow('布局约束非法');
		expect(create).not.toHaveBeenCalled();
	});
	it('keeps dry-run read-only and reports that geometry was not verified', async () => {
		expect(await placeAuto({ components: [device], dryRun: true })).toMatchObject({ dryRun: true, geometryVerified: false });
		expect(create).not.toHaveBeenCalled();
	});
});

describe('pin and NET collision protection', () => {
	it('exposes staircase fanout for named wires without terminal symbols', async () => {
		placed.set('a', { x: 0, y: 0 });
		getPins.mockResolvedValue([pin(0, 0, '1'), pin(0, 10, '2'), pin(0, 20, '3')]);
		const result = await handlePinNetConfigureTask({ routing: 'staircase', dryRun: true, assignments: ['1', '2', '3'].map(pinNumber => ({ componentId: 'a', pinNumber, netName: `N${pinNumber}` })) }) as any;
		expect(result.plan.map((p: any) => p.line.at(-1))).toEqual([-10, 10, 30]);
		expect(result.plan[0].line.length).toBe(8);
		expect(createWire).not.toHaveBeenCalled();
	});
	it('fans terminal leads out using only orthogonal segments', async () => {
		placed.set('a', { x: 0, y: 0 });
		getPins.mockResolvedValue([pin(0, 0, '1'), pin(0, 10, '2')]);
		const result = await handlePinNetConfigureTask({ dryRun: true, assignments: [
			{ componentId: 'a', pinNumber: '1', netName: 'VCC', terminal: 'power' },
			{ componentId: 'a', pinNumber: '2', netName: 'GND', terminal: 'ground' },
		] }) as any;
		for (const item of result.plan) for (let i = 0; i < item.line.length - 2; i += 2)
			expect(item.line[i] === item.line[i + 2] || item.line[i + 1] === item.line[i + 3]).toBe(true);
		expect(createWire).not.toHaveBeenCalled();
	});
	it.each([true, false])('rejects a lead through another symbol before any write (dryRun=%s)', async dryRun => {
		placed.set('a', { x: 0, y: 0 });
		placed.set('obstacle', { x: 50, y: 15 });
		await expect(handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }], dryRun })).rejects.toThrow('LAYOUT_COLLISION');
		expect(createWire).not.toHaveBeenCalled();
	});
	it('rejects a lead through visible text outside another symbol', async () => {
		placed.set('a', { x: 0, y: 0 });
		placed.set('obstacle', { x: 50, y: 100 });
		const bbox = eda.sch_Primitive.getPrimitivesBBox;
		(eda.sch_Primitive.getPrimitivesBBox as any) = async (ids: any) => ids[0] === 'text'
			? { minX: 40, maxX: 60, minY: -5, maxY: 5 } : bbox(ids);
		(eda.sch_PrimitiveAttribute.getAll as any) = async () => [{
			getState_PrimitiveId: () => 'text', getState_ParentPrimitiveId: () => 'obstacle',
			getState_Key: () => 'Name', getState_KeyVisible: () => false, getState_ValueVisible: () => true,
		}];
		await expect(handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] })).rejects.toThrow('LAYOUT_COLLISION');
		expect(createWire).not.toHaveBeenCalled();
	});
	it('accepts a state snapshot array returned by wire create', async () => {
		placed.set('a', { x: 0, y: 0 });
		createWire.mockImplementationOnce(async (line: number[], net: string) => {
			netWires.set('snapshot-wire', { x: line[0], y: line[1], net, line });
			return [{ primitiveId: 'snapshot-wire' }] as any;
		});
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] }))
			.toMatchObject({ ok: true, results: [{ primitiveId: 'snapshot-wire', executionState: 'net_confirmed' }] });
	});
	it('connects dense parallel pins without adding overlapping power symbols', async () => {
		placed.set('a', { x: 0, y: 0 }); placed.set('b', { x: 0, y: 10 });
		// Pins at the edges of separate small symbols, not overlapping mock bodies.
		(eda.sch_Primitive.getPrimitivesBBox as any) = async ([id]: string[]) => {
			const p = placed.get(id)!;
			return { minX: p.x - 20, maxX: p.x, minY: p.y - 2, maxY: p.y + 2 };
		};
		expect(await handlePinNetConfigureTask({ assignments: [
			{ componentId: 'a', pinNumber: '1', netName: '3V3' },
			{ componentId: 'b', pinNumber: '1', netName: 'GND' },
		] })).toMatchObject({ ok: true });
		expect(createWire).toHaveBeenNthCalledWith(1, [0, 0, 80, 0], '3V3', null, null, null);
		expect(createWire).toHaveBeenNthCalledWith(2, [0, 10, 80, 10], 'GND', null, null, null);
		expect(eda.sch_PrimitiveComponent.createNetFlag).not.toHaveBeenCalled();
	});
	it('does not accept a displaced symbol whose actual pin misses the lead', async () => {
		placed.set('a', { x: 0, y: 0 });
		(eda.sch_PrimitiveComponent.createNetFlag as any).mockResolvedValue(primitive('wrong-anchor', 80, 0));
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'GND', terminal: 'ground' }] }))
			.toMatchObject({ ok: false, results: [{ error: expect.stringContaining('实际引脚未接到') }] });
		expect(remove).toHaveBeenCalledWith('net-0');
	});
	it('rejects overlapping endpoints belonging to another net before writing', async () => {
		placed.set('a', { x: 0, y: 0 });
		getComponents.mockResolvedValue([primitive('a', 0, 0),
			{ ...primitive('gnd', 0, 0), getState_ComponentType: () => 'netflag', getState_Net: () => 'GND' }]);
		await expect(handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: '3V3' }] })).rejects.toThrow('PIN_COLLISION');
		expect(createWire).not.toHaveBeenCalled();
	});
	it('rejects apparent port success when the exported netlist has no electrical connection', async () => {
		placed.set('a', { x: 0, y: 0 });
		(eda.sch_ManufactureData.getNetlistFile as any) = async () => ({ text: async () => JSON.stringify({ components: { a: { pinInfoMap: { '1': { net: '' } } } } }) });
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] }))
			.toMatchObject({ ok: false, remainingIndices: [0], results: [{ primitiveId: 'net-0', error: expect.stringContaining('网表未确认') }] });
		expect(createWire).toHaveBeenCalledTimes(1);
	});
	it('preserves created IDs when netlist export fails', async () => {
		placed.set('a', { x: 0, y: 0 });
		(eda.sch_ManufactureData.getNetlistFile as any) = async () => undefined;
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] }))
			.toMatchObject({ ok: false, results: [{ primitiveId: 'net-0', error: expect.stringContaining('网表不可用') }] });
	});
	it('bonds overlapping same-name marker endpoints with a real wire', async () => {
		placed.set('a', { x: 0, y: 0 });
		getComponents.mockResolvedValue([
			primitive('a', 0, 0),
			{ ...primitive('existing-net', 0, 0), getState_ComponentType: () => 'netport', getState_Net: () => 'VCC' },
		]);
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] }))
			.toMatchObject({ ok: true, results: [{ executionState: 'net_confirmed' }] });
		expect(createWire).toHaveBeenCalledTimes(1);
	});
	it('stops on an empty native NET return instead of trying alternative write APIs', async () => {
		placed.set('a', { x: 0, y: 0 });
		createWire.mockResolvedValueOnce(undefined as any);
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] }))
			.toMatchObject({ ok: false, remainingIndices: [0], results: [{ error: expect.stringContaining('Escape Hatch') }] });
		expect(createWire).toHaveBeenCalledTimes(1);
	});
	it('does not confirm a NET whose symbol anchor matches but pin endpoint does not', async () => {
		placed.set('a', { x: 0, y: 0 });
		getWire.mockResolvedValueOnce({ getState_Net: () => 'VCC', getState_Line: () => [25, 0, 80, 0] });
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] }))
			.toMatchObject({ ok: false, results: [{ primitiveId: 'net-0', executionState: 'unconfirmed' }] });
	});
	it('rejects incomplete bounding boxes instead of silently accepting NaN comparisons', () => {
		expect(() => validBox({} as any)).toThrow('GEOMETRY_UNAVAILABLE');
		expect(() => validBox({ minX: 0, maxX: 1, minY: 0 } as any)).toThrow('GEOMETRY_UNAVAILABLE');
	});
	it('creates separated labels when the SDK omits label bounding boxes', async () => {
		placed.set('a', { x: 0, y: 0 });
		placed.set('b', { x: 1000, y: 0 });
		(eda.sch_Primitive.getPrimitivesBBox as any) = async () => undefined;
		expect(await handlePinNetConfigureTask({ assignments: [
			{ componentId: 'a', pinNumber: '1', netName: 'VCC' },
			{ componentId: 'b', pinNumber: '1', netName: 'GND' },
		] })).toMatchObject({ ok: true, attempted: 2 });
	});
	it('detects wire intersections in the middle of segments, including diagonals', () => {
		expect(pointOnWire(5, 5, [[0, 0], [10, 10]])).toBe(true);
		expect(pointOnWire(5, 6, [0, 0, 10, 10])).toBe(false);
		expect(overlaps({ minX: 0, maxX: 10, minY: 0, maxY: 10 }, { minX: 20, maxX: 30, minY: 0, maxY: 10 }, 10)).toBe(true);
	});
	it('prevents pin adhesion from merging unrelated components', async () => {
		placed.set('a', { x: 0, y: 0 });
		placed.set('b', { x: 0, y: 0 });
		await expect(handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] })).rejects.toThrow('PIN_COLLISION');
		expect(createWire).not.toHaveBeenCalled();
	});
	it('rejects relabelling an existing wire to a different NET', async () => {
		placed.set('a', { x: 0, y: 0 });
		getWires.mockResolvedValue([{ getState_Line: () => [-10, 0, 10, 0], getState_Net: () => 'GND' }]);
		await expect(handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] })).rejects.toThrow('NET_CONFLICT');
		expect(createWire).not.toHaveBeenCalled();
	});
	it('confirms a NET label by reading its value and exact pin position', async () => {
		placed.set('a', { x: 0, y: 0 });
		expect(await handlePinNetConfigureTask({ assignments: [{ componentId: 'a', pinNumber: '1', netName: 'VCC' }] })).toMatchObject({ ok: true, results: [{ executionState: 'net_confirmed' }] });
		expect(createWire).toHaveBeenCalledWith([0, 0, 80, 0], 'VCC', null, null, null);
	});
	it('does not hide unattempted assignments after uncertain label readback', async () => {
		placed.set('a', { x: 100, y: 0 });
		getWire.mockResolvedValueOnce({ getState_Net: () => 'VCC', getState_Line: () => [0, 0, 80, 0] });
		placed.set('b', { x: 1000, y: 0 });
		expect(await handlePinNetConfigureTask({ assignments: [
			{ componentId: 'a', pinNumber: '1', netName: 'VCC' },
			{ componentId: 'b', pinNumber: '1', netName: 'GND' },
		] })).toMatchObject({ ok: false, attempted: 1, remainingIndices: [0, 1] });
		expect(createWire).toHaveBeenCalledTimes(1);
	});
	it('prevents different planned NET names on the same connected wire chain', async () => {
		placed.set('a', { x: 0, y: 0 });
		placed.set('b', { x: 100, y: 0 });
		getWires.mockResolvedValue([
			{ getState_Line: () => [0, 0, 50, 0], getState_Net: () => '' },
			{ getState_Line: () => [50, 0, 100, 0], getState_Net: () => '' },
		]);
		await expect(handlePinNetConfigureTask({ assignments: [
			{ componentId: 'a', pinNumber: '1', netName: 'VCC' },
			{ componentId: 'b', pinNumber: '1', netName: 'GND' },
		] })).rejects.toThrow('NET_CONFLICT');
		expect(createWire).not.toHaveBeenCalled();
	});
});
