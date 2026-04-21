import { describe, expect, it } from 'vitest';

import {
	buildSnappedNodeKey,
	distancePointToPoints,
	distancePointToPolygonBoundary,
	estimatePolygonArea,
	mergeBoundingBoxes,
	segmentIntersectsPolygon,
} from './geometry-utils.ts';

describe('geometry-utils', () => {
	it('estimates polygon area with the shoelace formula', () => {
		expect(estimatePolygonArea([
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
			{ x: 6, y: 4 },
			{ x: 0, y: 4 },
		])).toBe(24);
	});

	it('merges bounding boxes while ignoring null values', () => {
		expect(mergeBoundingBoxes([
			{ minX: 1, minY: 2, maxX: 5, maxY: 6 },
			null,
			{ minX: -3, minY: 0, maxX: 2, maxY: 9 },
		])).toEqual({
			minX: -3,
			minY: 0,
			maxX: 5,
			maxY: 9,
		});
	});

	it('detects when a segment intersects a polygon', () => {
		const polygon = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		];

		expect(segmentIntersectsPolygon({ x: -2, y: 5 }, { x: 12, y: 5 }, polygon)).toBe(true);
		expect(segmentIntersectsPolygon({ x: -2, y: -2 }, { x: -1, y: -1 }, polygon)).toBe(false);
	});

	it('measures point-to-polygon boundary distance', () => {
		const polygon = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		];

		expect(distancePointToPolygonBoundary({ x: 5, y: 5 }, polygon)).toBeCloseTo(5);
		expect(distancePointToPolygonBoundary({ x: 12, y: 5 }, polygon)).toBeCloseTo(2);
	});

	it('finds the nearest point distance within a point set', () => {
		expect(distancePointToPoints(
			{ x: 3, y: 4 },
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
			],
		)).toBeCloseTo(5);
		expect(distancePointToPoints({ x: 1, y: 1 }, [])).toBeNull();
	});

	it('builds snapped node keys using a caller-provided tolerance', () => {
		expect(buildSnappedNodeKey(10.002, 19.998, 0.01)).toBe('10.000:20.000');
		expect(buildSnappedNodeKey(10.002, 19.998, 0.1)).toBe('10.0:20.0');
	});
});
