import type { PcbBoardOutlineSegmentSnapshot, PcbBoundingBox, PcbPoint, PcbPolygonSnapshot } from '../../../../shared/pcb-geometry-engine.ts';

const TAU = Math.PI * 2;
const EPSILON = 1e-6;

export function distanceBetweenPoints(a: PcbPoint, b: PcbPoint): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distancePointToPoints(point: PcbPoint, points: PcbPoint[]): number | null {
	if (points.length === 0) {
		return null;
	}
	return Math.min(...points.map(candidate => distanceBetweenPoints(point, candidate)));
}

export function buildSnappedNodeKey(x: number, y: number, tolerance: number): string {
	const safeTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 1e-3;
	const snappedX = Math.round(x / safeTolerance) * safeTolerance;
	const snappedY = Math.round(y / safeTolerance) * safeTolerance;
	const decimals = safeTolerance >= 0.1 ? 1 : 3;
	return `${snappedX.toFixed(decimals)}:${snappedY.toFixed(decimals)}`;
}

export function createBoundingBox(points: PcbPoint[]): PcbBoundingBox | null {
	if (points.length === 0) {
		return null;
	}

	let minX = points[0].x;
	let minY = points[0].y;
	let maxX = points[0].x;
	let maxY = points[0].y;
	for (const point of points) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}

	return { minX, minY, maxX, maxY };
}

export function mergeBoundingBoxes(boxes: Array<PcbBoundingBox | null | undefined>): PcbBoundingBox | null {
	const valid = boxes.filter((box): box is PcbBoundingBox => box != null);
	if (valid.length === 0) {
		return null;
	}

	let minX = valid[0].minX;
	let minY = valid[0].minY;
	let maxX = valid[0].maxX;
	let maxY = valid[0].maxY;
	for (const box of valid) {
		minX = Math.min(minX, box.minX);
		minY = Math.min(minY, box.minY);
		maxX = Math.max(maxX, box.maxX);
		maxY = Math.max(maxY, box.maxY);
	}

	return { minX, minY, maxX, maxY };
}

export function estimatePolygonArea(points: PcbPoint[]): number {
	if (points.length < 3) {
		return 0;
	}

	let doubledArea = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		doubledArea += (current.x * next.y) - (next.x * current.y);
	}
	return Math.abs(doubledArea) / 2;
}

export interface ArcGeometry {
	center: PcbPoint;
	radius: number;
	startAngle: number;
	sweepAngleRad: number;
	length: number;
}

export function deriveArcGeometry(start: PcbPoint, end: PcbPoint, arcAngleDegrees: number): ArcGeometry | null {
	const sweepAngleRad = arcAngleDegrees * Math.PI / 180;
	const absSweep = Math.abs(sweepAngleRad);
	const chord = distanceBetweenPoints(start, end);
	if (chord <= EPSILON || absSweep <= EPSILON || absSweep >= TAU - EPSILON) {
		return null;
	}

	const radius = chord / (2 * Math.sin(absSweep / 2));
	if (!Number.isFinite(radius) || radius <= EPSILON) {
		return null;
	}

	const mid = {
		x: (start.x + end.x) / 2,
		y: (start.y + end.y) / 2,
	};
	const halfChord = chord / 2;
	const height = Math.sqrt(Math.max(radius * radius - halfChord * halfChord, 0));
	const direction = {
		x: (end.x - start.x) / chord,
		y: (end.y - start.y) / chord,
	};
	const leftNormal = { x: -direction.y, y: direction.x };
	const orientation = arcAngleDegrees >= 0 ? 1 : -1;
	const center = {
		x: mid.x + leftNormal.x * height * orientation,
		y: mid.y + leftNormal.y * height * orientation,
	};
	const startAngle = Math.atan2(start.y - center.y, start.x - center.x);

	return {
		center,
		radius,
		startAngle,
		sweepAngleRad,
		length: radius * absSweep,
	};
}

export function sampleArc(start: PcbPoint, end: PcbPoint, arcAngleDegrees: number, maxStep: number): PcbPoint[] {
	const geometry = deriveArcGeometry(start, end, arcAngleDegrees);
	if (!geometry) {
		return [start, end];
	}

	const sampleCount = Math.max(2, Math.ceil(geometry.length / Math.max(1, maxStep)));
	const output: PcbPoint[] = [];
	for (let index = 0; index <= sampleCount; index += 1) {
		const ratio = index / sampleCount;
		const angle = geometry.startAngle + geometry.sweepAngleRad * ratio;
		output.push({
			x: geometry.center.x + geometry.radius * Math.cos(angle),
			y: geometry.center.y + geometry.radius * Math.sin(angle),
		});
	}
	return output;
}

export function sampleLine(start: PcbPoint, end: PcbPoint, maxStep: number): PcbPoint[] {
	const length = distanceBetweenPoints(start, end);
	if (length <= EPSILON) {
		return [start];
	}

	const sampleCount = Math.max(1, Math.ceil(length / Math.max(1, maxStep)));
	const output: PcbPoint[] = [];
	for (let index = 0; index <= sampleCount; index += 1) {
		const ratio = index / sampleCount;
		output.push({
			x: start.x + (end.x - start.x) * ratio,
			y: start.y + (end.y - start.y) * ratio,
		});
	}
	return output;
}

function sampleCubicBezier(start: PcbPoint, controlA: PcbPoint, controlB: PcbPoint, end: PcbPoint, segments = 12): PcbPoint[] {
	const output: PcbPoint[] = [];
	for (let index = 0; index <= segments; index += 1) {
		const t = index / segments;
		const oneMinusT = 1 - t;
		output.push({
			x: (oneMinusT ** 3) * start.x
				+ 3 * (oneMinusT ** 2) * t * controlA.x
				+ 3 * oneMinusT * (t ** 2) * controlB.x
				+ (t ** 3) * end.x,
			y: (oneMinusT ** 3) * start.y
				+ 3 * (oneMinusT ** 2) * t * controlA.y
				+ 3 * oneMinusT * (t ** 2) * controlB.y
				+ (t ** 3) * end.y,
		});
	}
	return output;
}

export function rectanglePoints(x: number, y: number, width: number, height: number, rotation: number): PcbPoint[] {
	const cx = x + width / 2;
	const cy = y + height / 2;
	const radians = rotation * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const rawPoints = [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height },
	];

	return rawPoints.map((point) => {
		const dx = point.x - cx;
		const dy = point.y - cy;
		return {
			x: cx + dx * cos - dy * sin,
			y: cy + dx * sin + dy * cos,
		};
	});
}

function segmentOrientation(a: PcbPoint, b: PcbPoint, c: PcbPoint): number {
	return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
}

function pointOnSegment(point: PcbPoint, start: PcbPoint, end: PcbPoint): boolean {
	return point.x <= Math.max(start.x, end.x) + EPSILON
		&& point.x + EPSILON >= Math.min(start.x, end.x)
		&& point.y <= Math.max(start.y, end.y) + EPSILON
		&& point.y + EPSILON >= Math.min(start.y, end.y);
}

export function segmentsIntersect(startA: PcbPoint, endA: PcbPoint, startB: PcbPoint, endB: PcbPoint): boolean {
	const orientation1 = segmentOrientation(startA, endA, startB);
	const orientation2 = segmentOrientation(startA, endA, endB);
	const orientation3 = segmentOrientation(startB, endB, startA);
	const orientation4 = segmentOrientation(startB, endB, endA);
	const firstCrosses = (orientation1 > EPSILON && orientation2 < -EPSILON)
		|| (orientation1 < -EPSILON && orientation2 > EPSILON);
	const secondCrosses = (orientation3 > EPSILON && orientation4 < -EPSILON)
		|| (orientation3 < -EPSILON && orientation4 > EPSILON);

	if (firstCrosses && secondCrosses) {
		return true;
	}

	if (Math.abs(orientation1) <= EPSILON && pointOnSegment(startB, startA, endA)) {
		return true;
	}
	if (Math.abs(orientation2) <= EPSILON && pointOnSegment(endB, startA, endA)) {
		return true;
	}
	if (Math.abs(orientation3) <= EPSILON && pointOnSegment(startA, startB, endB)) {
		return true;
	}
	if (Math.abs(orientation4) <= EPSILON && pointOnSegment(endA, startB, endB)) {
		return true;
	}
	return false;
}

export function distanceSegmentToSegment(startA: PcbPoint, endA: PcbPoint, startB: PcbPoint, endB: PcbPoint): number {
	if (segmentsIntersect(startA, endA, startB, endB)) {
		return 0;
	}
	return Math.min(
		distancePointToSegment(startA, startB, endB),
		distancePointToSegment(endA, startB, endB),
		distancePointToSegment(startB, startA, endA),
		distancePointToSegment(endB, startA, endA),
	);
}

export function distancePointToPolygonBoundary(point: PcbPoint, polygon: PcbPoint[]): number | null {
	if (polygon.length < 2) {
		return null;
	}

	let best = Number.POSITIVE_INFINITY;
	for (let index = 0; index < polygon.length; index += 1) {
		const current = polygon[index];
		const next = polygon[(index + 1) % polygon.length];
		best = Math.min(best, distancePointToSegment(point, current, next));
	}
	return Number.isFinite(best) ? best : null;
}

export function segmentIntersectsPolygon(start: PcbPoint, end: PcbPoint, polygon: PcbPoint[]): boolean {
	if (polygon.length < 3) {
		return false;
	}

	if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) {
		return true;
	}

	for (let index = 0; index < polygon.length; index += 1) {
		const polygonStart = polygon[index];
		const polygonEnd = polygon[(index + 1) % polygon.length];
		if (segmentsIntersect(start, end, polygonStart, polygonEnd)) {
			return true;
		}
	}
	return false;
}

export function polylineIntersectsPolygon(polyline: PcbPoint[], polygon: PcbPoint[]): boolean {
	if (polyline.length === 0 || polygon.length < 3) {
		return false;
	}

	if (polyline.some(point => pointInPolygon(point, polygon))) {
		return true;
	}

	for (let lineIndex = 0; lineIndex + 1 < polyline.length; lineIndex += 1) {
		const lineStart = polyline[lineIndex];
		const lineEnd = polyline[lineIndex + 1];
		if (segmentIntersectsPolygon(lineStart, lineEnd, polygon)) {
			return true;
		}
	}
	return false;
}

export function distancePolylineToPolygon(polyline: PcbPoint[], polygon: PcbPoint[]): number | null {
	if (polyline.length === 0 || polygon.length < 3) {
		return null;
	}

	if (polylineIntersectsPolygon(polyline, polygon)) {
		return 0;
	}

	let best = Number.POSITIVE_INFINITY;
	for (let lineIndex = 0; lineIndex + 1 < polyline.length; lineIndex += 1) {
		const lineStart = polyline[lineIndex];
		const lineEnd = polyline[lineIndex + 1];
		for (let polygonIndex = 0; polygonIndex < polygon.length; polygonIndex += 1) {
			const polygonStart = polygon[polygonIndex];
			const polygonEnd = polygon[(polygonIndex + 1) % polygon.length];
			best = Math.min(best, distanceSegmentToSegment(lineStart, lineEnd, polygonStart, polygonEnd));
		}
	}

	for (const point of polyline) {
		const boundaryDistance = distancePointToPolygonBoundary(point, polygon);
		if (boundaryDistance != null) {
			best = Math.min(best, boundaryDistance);
		}
	}

	return Number.isFinite(best) ? best : null;
}

export function polygonSourceToPoints(source: PcbPolygonSnapshot['source'], step = 8): PcbPoint[] {
	if (source.length === 0) {
		return [];
	}

	if (source[0] === 'R') {
		if (source.length < 7) {
			return [];
		}
		return rectanglePoints(
			Number(source[1]),
			Number(source[2]),
			Number(source[3]),
			Number(source[4]),
			Number(source[5]),
		);
	}

	if (source[0] === 'CIRCLE') {
		if (source.length < 4) {
			return [];
		}
		const cx = Number(source[1]);
		const cy = Number(source[2]);
		const radius = Number(source[3]);
		const segments = 24;
		const output: PcbPoint[] = [];
		for (let index = 0; index < segments; index += 1) {
			const angle = TAU * index / segments;
			output.push({
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle),
			});
		}
		return output;
	}

	if (typeof source[0] !== 'number' || typeof source[1] !== 'number') {
		return [];
	}

	let cursor: PcbPoint = { x: Number(source[0]), y: Number(source[1]) };
	const output: PcbPoint[] = [cursor];
	let index = 2;
	while (index < source.length) {
		const token = source[index];
		if (token === 'L') {
			index += 1;
			while (index + 1 < source.length && typeof source[index] === 'number' && typeof source[index + 1] === 'number') {
				cursor = { x: Number(source[index]), y: Number(source[index + 1]) };
				output.push(cursor);
				index += 2;
			}
			continue;
		}

		if (token === 'ARC' || token === 'CARC') {
			if (index + 3 >= source.length) {
				break;
			}
			const arcAngle = Number(source[index + 1]);
			const end = { x: Number(source[index + 2]), y: Number(source[index + 3]) };
			const arcPoints = sampleArc(cursor, end, arcAngle, step);
			output.push(...arcPoints.slice(1));
			cursor = end;
			index += 4;
			continue;
		}

		if (token === 'C') {
			index += 1;
			while (index + 5 < source.length
				&& typeof source[index] === 'number'
				&& typeof source[index + 1] === 'number'
				&& typeof source[index + 2] === 'number'
				&& typeof source[index + 3] === 'number'
				&& typeof source[index + 4] === 'number'
				&& typeof source[index + 5] === 'number') {
				const controlA = { x: Number(source[index]), y: Number(source[index + 1]) };
				const controlB = { x: Number(source[index + 2]), y: Number(source[index + 3]) };
				const end = { x: Number(source[index + 4]), y: Number(source[index + 5]) };
				output.push(...sampleCubicBezier(cursor, controlA, controlB, end).slice(1));
				cursor = end;
				index += 6;
			}
			continue;
		}

		index += 1;
	}

	return output;
}

export function pointInPolygon(point: PcbPoint, polygon: PcbPoint[]): boolean {
	if (polygon.length < 3) {
		return false;
	}

	let windingNumber = 0;
	for (let index = 0; index < polygon.length; index += 1) {
		const current = polygon[index];
		const next = polygon[(index + 1) % polygon.length];
		if (Math.abs(current.y - next.y) <= EPSILON) {
			continue;
		}
		const isUpward = current.y <= point.y && next.y > point.y;
		const isDownward = current.y > point.y && next.y <= point.y;
		if (!isUpward && !isDownward) {
			continue;
		}
		const cross = ((point.x - current.x) * (next.y - current.y)) - ((point.y - current.y) * (next.x - current.x));
		if (isUpward && cross < 0) {
			windingNumber -= 1;
		}
		if (isDownward && cross > 0) {
			windingNumber += 1;
		}
	}
	return windingNumber !== 0;
}

export function distancePointToSegment(point: PcbPoint, start: PcbPoint, end: PcbPoint): number {
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) {
		return distanceBetweenPoints(point, start);
	}

	const t = Math.max(0, Math.min(1, (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / ((dx * dx) + (dy * dy))));
	const projected = {
		x: start.x + dx * t,
		y: start.y + dy * t,
	};
	return distanceBetweenPoints(point, projected);
}

export function distancePointToBoardOutline(point: PcbPoint, segments: PcbBoardOutlineSegmentSnapshot[], step = 8): number | null {
	if (segments.length === 0) {
		return null;
	}

	let best = Number.POSITIVE_INFINITY;
	for (const segment of segments) {
		if (segment.kind === 'line') {
			best = Math.min(best, distancePointToSegment(point, segment.start, segment.end));
			continue;
		}
		const arcPoints = sampleArc(segment.start, segment.end, segment.arcAngle ?? 0, step);
		for (let index = 0; index + 1 < arcPoints.length; index += 1) {
			best = Math.min(best, distancePointToSegment(point, arcPoints[index], arcPoints[index + 1]));
		}
	}

	return Number.isFinite(best) ? best : null;
}
