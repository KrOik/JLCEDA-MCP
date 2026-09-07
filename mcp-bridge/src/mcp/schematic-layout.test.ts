import type { LayoutOptions, LayoutPart } from './schematic-layout';
import { describe, expect, it } from 'vitest';
import { obstacleOverlaps, translateBox, validBox, wireObstacles } from './layout-safety';
import { findLocalPosition, planSchematicLayout } from './schematic-layout';

const options: LayoutOptions = { mode: 'compact', startX: 0, startY: 0, grid: 10, gap: 20, groupGap: 60, padding: 20, columns: 4, maxRadius: 1000, weakNets: ['GND'] };
const small: LayoutPart = { id: 'c1', group: 'power', box: { minX: -10, maxX: 10, minY: -20, maxY: 20 }, ports: [{ pinNumber: '1', x: -10, y: 0 }, { pinNumber: '2', x: 10, y: 0 }], nets: { 1: 'signal', 2: 'GND' } };

describe('measured schematic geometry and local placement', () => {
	it('normalizes real Pro Y-up bounds without inflating the symbol', () => {
		expect(validBox({ minX: 4994.5, maxX: 5005.5, minY: 1008.5, maxY: 991.5 })).toEqual({ minX: 4994.5, maxX: 5005.5, minY: 991.5, maxY: 1008.5 });
		expect(() => validBox({ minX: 0, maxX: Infinity, minY: 0, maxY: 10 })).toThrow();
	});
	it('allows space inside an L-shaped wire while rejecting its actual arms and stroke', () => {
		const obstacles = wireObstacles('L', [0, 0, 100, 0, 100, 100], 4);
		expect(obstacles.some(o => obstacleOverlaps({ minX: 20, maxX: 40, minY: 20, maxY: 40 }, o, 10))).toBe(false);
		expect(obstacles.some(o => obstacleOverlaps({ minX: 88, maxX: 90, minY: 20, maxY: 40 }, o, 10))).toBe(true);
	});
	it('tests diagonal segments rather than their rectangular envelope', () => {
		const [wire] = wireObstacles('d', [[0, 0], [100, 100]], 0);
		expect(obstacleOverlaps({ minX: 5, maxX: 15, minY: 70, maxY: 80 }, wire, 5)).toBe(false);
		expect(obstacleOverlaps({ minX: 40, maxX: 50, minY: 40, maxY: 50 }, wire, 5)).toBe(true);
		expect(() => wireObstacles('bad', [0, 0, Number.NaN, 10])).toThrow();
	});
	it('searches near the requested anchor and respects a bounded failure', () => {
		const near = { id: 'near', box: { minX: -20, maxX: 20, minY: -20, maxY: 20 } };
		const far = { id: 'far', box: { minX: 10000, maxX: 10100, minY: 0, maxY: 100 } };
		const p = findLocalPosition(small.box, { x: 0, y: 0 }, [near, far], 20, 10, 100)!;
		expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(200);
		expect(obstacleOverlaps(translateBox(small.box, p.x, p.y), near, 20)).toBe(false);
		expect(findLocalPosition(small.box, { x: 0, y: 0 }, [near], 20, 10, 10)).toBeUndefined();
	});

	it.each(['compact', 'elk'] as const)('packs different-sized parts and keeps functional groups separate with %s', async (mode) => {
		const parts = [small, { ...small, id: 'c2' }, { ...small, id: 'u1', group: 'mcu', box: { minX: -75.5, maxX: 75.5, minY: -125.5, maxY: 125.5 } }];
		const plan = await planSchematicLayout(parts, [], { ...options, mode });
		expect(plan.positions).toHaveLength(3);
		const boxes = plan.positions.map(p => ({ id: p.id, box: translateBox(parts.find(part => part.id === p.id)!.box, p.x, p.y) }));
		for (const [i, a] of boxes.entries()) {
			for (const b of boxes.slice(i + 1)) expect(obstacleOverlaps(a.box, b, options.gap)).toBe(false);
		}
		expect(obstacleOverlaps(plan.groups[0].box, plan.groups[1], options.groupGap)).toBe(false);
		const c1 = plan.positions.find(p => p.id === 'c1')!;
		const c2 = plan.positions.find(p => p.id === 'c2')!;
		expect(Math.hypot(c1.x - c2.x, c1.y - c2.y)).toBeLessThan(300);
		for (const p of plan.positions) {
			expect(p.x % 10).toBeCloseTo(0);
			expect(p.y % 10).toBeCloseTo(0);
		}
	});
	it('keeps fixed physical pin offsets through ELK and does not mutate caller input', async () => {
		const parts = [small, { ...small, id: 'c2', nets: { 2: 'signal' } }];
		const before = JSON.stringify(parts);
		const a = await planSchematicLayout(parts, [], { ...options, mode: 'elk' });
		const b = await planSchematicLayout(parts, [], { ...options, mode: 'elk' });
		expect(a).toEqual(b);
		expect(JSON.stringify(parts)).toBe(before);
	});
});
