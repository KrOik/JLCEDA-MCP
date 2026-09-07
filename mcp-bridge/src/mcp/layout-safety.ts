import { readSchematicWires } from './schematic-wire-reader';

export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export interface Obstacle { id: string; box: Box; segment?: [number, number, number, number]; halfWidth?: number }

/** Conservative envelope when the installed EDA API does not expose BBox. */
export const FALLBACK_COMPONENT_HALF_SIZE = 250;

export function validBox(value: Box | undefined): Box {
	if (!value || ![value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite)) {
		throw new Error('GEOMETRY_UNAVAILABLE: 无法获取可靠包围盒，停止放置');
	}
	// Pro uses an upward Y axis and can return minY > maxY (verified live).
	return { minX: Math.min(value.minX, value.maxX), maxX: Math.max(value.minX, value.maxX), minY: Math.min(value.minY, value.maxY), maxY: Math.max(value.minY, value.maxY) };
}

export function unionBoxes(boxes: Box[]): Box {
	if (!boxes.length) throw new Error('GEOMETRY_UNAVAILABLE: 空几何集合');
	return { minX: Math.min(...boxes.map(b => b.minX)), minY: Math.min(...boxes.map(b => b.minY)), maxX: Math.max(...boxes.map(b => b.maxX)), maxY: Math.max(...boxes.map(b => b.maxY)) };
}

export async function readMeasuredBox(primitive: any, id: string): Promise<Box | undefined> {
	for (const input of [[id], [primitive]]) {
		try { return validBox(await eda.sch_Primitive.getPrimitivesBBox(input)); }
		catch { /* SDKs differ in whether IDs or primitive instances are accepted. */ }
	}
	return undefined;
}

/** World-coordinate bounds; never infer symbol dimensions from pin spacing alone. */
export async function readComponentGeometry(primitive: any, id: string) {
	const measured = await readMeasuredBox(primitive, id);
	const body = measured ?? fallbackObstacleBox(primitive);
	if (!body) throw new Error(`GEOMETRY_UNAVAILABLE: ${id}`);
	const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(id);
	if (!pins) throw new Error(`GEOMETRY_UNAVAILABLE: ${id} 引脚不可用`);
	const boxes = [body];
	const ports = pins.map(pin => {
		const x = pin.getState_X(); const y = pin.getState_Y();
		if (![x, y].every(Number.isFinite)) throw new Error('GEOMETRY_UNAVAILABLE: 引脚坐标非法');
		boxes.push({ minX: x, maxX: x, minY: y, maxY: y });
		return { pinNumber: pin.getState_PinNumber(), x, y, rotation: (pin as any).getState_Rotation?.() ?? 0 };
	});
	const attributes = await eda.sch_PrimitiveAttribute.getAll(id);
	let attributesMeasured = true;
	for (const attribute of attributes) {
		const a = attribute as any;
		if (a.getState_ParentPrimitiveId?.() !== id) continue;
		// Metadata attributes use null visibility and an SDK placeholder bbox at
		// the origin. Only explicitly rendered text contributes to layout bounds.
		if (a.getState_KeyVisible?.() !== true && a.getState_ValueVisible?.() !== true) continue;
		const attributeBox = await readMeasuredBox(a, a.getState_PrimitiveId());
		// A visible expression such as ={Value} may resolve to empty text.
		// Its measured zero-area placeholder has no rendered collision extent.
		if (attributeBox && attributeBox.minX === attributeBox.maxX && attributeBox.minY === attributeBox.maxY) continue;
		attributesMeasured &&= Boolean(attributeBox);
		boxes.push(attributeBox ?? await reliableOrConservativeBox(a, a.getState_PrimitiveId()));
	}
	return { box: unionBoxes(boxes), body, ports, source: measured && attributesMeasured ? 'sdk-bbox' as const : 'conservative' as const, measured: Boolean(measured) && attributesMeasured };
}

export function wireObstacles(id: string, raw: unknown, width = 0): Obstacle[] {
	const points = Array.isArray(raw) ? (Array.isArray(raw[0]) ? raw.flat() : raw) as number[] : [];
	if (points.length < 4 || points.length % 2 || !points.every(Number.isFinite) || !Number.isFinite(width) || width < 0)
		throw new Error('GEOMETRY_UNAVAILABLE: 导线坐标/线宽非法');
	const result: Obstacle[] = [];
	for (let i = 0; i + 3 < points.length; i += 2) {
		const [ax, ay, bx, by] = points.slice(i, i + 4);
		result.push({ id, box: validBox({ minX: ax, minY: ay, maxX: bx, maxY: by }), segment: [ax, ay, bx, by], halfWidth: width / 2 });
	}
	return result;
}

/** Slab intersection against an inflated box handles orthogonal AND diagonal segments. */
export function obstacleOverlaps(box: Box, obstacle: Obstacle, clearance: number): boolean {
	if (!obstacle.segment) return overlaps(box, obstacle.box, clearance);
	const gap = clearance + (obstacle.halfWidth ?? 0);
	const [ax, ay, bx, by] = obstacle.segment;
	let lo = 0; let hi = 1;
	for (const [a, delta, min, max] of [[ax, bx - ax, box.minX - gap, box.maxX + gap], [ay, by - ay, box.minY - gap, box.maxY + gap]]) {
		if (delta === 0) { if (a < min || a > max) return false; }
		else { const t1 = (min - a) / delta; const t2 = (max - a) / delta; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
		if (lo > hi) return false;
	}
	return true;
}

function finiteCoordinate(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function fallbackObstacleBox(primitive: any): Box | undefined {
	if (typeof primitive.getState_Line === 'function') {
		const line = primitive.getState_Line();
		if (Array.isArray(line)) {
			const points = (Array.isArray(line[0]) ? line.flat() : line) as number[];
			if (points.length >= 4 && points.length % 2 === 0 && points.every(Number.isFinite)) {
				return { minX: Math.min(...points.filter((_, index) => index % 2 === 0)), maxX: Math.max(...points.filter((_, index) => index % 2 === 0)), minY: Math.min(...points.filter((_, index) => index % 2 === 1)), maxY: Math.max(...points.filter((_, index) => index % 2 === 1)) };
			}
		}
	}
	const x = finiteCoordinate(primitive.getState_X?.());
	const y = finiteCoordinate(primitive.getState_Y?.());
	if (x === undefined || y === undefined)
		return undefined;
	// The current Pro API release returns undefined from getPrimitivesBBox even
	// for ordinary parts. Keep a deliberately large envelope rather than
	// silently allowing a potentially colliding placement.
	const isPart = primitive.getState_ComponentType?.() === 'part';
	const labelText = primitive.getState_Value?.() ?? primitive.getState_Net?.();
	const textWidth = typeof labelText === 'string' ? labelText.length * 12 : 0;
	return isPart
		? { minX: x - FALLBACK_COMPONENT_HALF_SIZE, maxX: x + FALLBACK_COMPONENT_HALF_SIZE, minY: y - FALLBACK_COMPONENT_HALF_SIZE, maxY: y + FALLBACK_COMPONENT_HALF_SIZE }
		: { minX: x - 20, maxX: x + 20 + textWidth, minY: y - 20, maxY: y + 20 };
}

export async function reliableOrConservativeBox(primitive: any, id: string): Promise<Box> {
	const box = await readMeasuredBox(primitive, id);
	if (box) return box;
	{
		const fallback = fallbackObstacleBox(primitive);
		if (fallback)
			return fallback;
		throw new Error(`GEOMETRY_UNAVAILABLE: 图元 ${id} 无可靠包围盒或保守坐标`);
	}
}

export function overlaps(a: Box, b: Box, clearance: number): boolean {
	return a.minX <= b.maxX + clearance && a.maxX >= b.minX - clearance
		&& a.minY <= b.maxY + clearance && a.maxY >= b.minY - clearance;
}

export function translateBox(box: Box, dx: number, dy: number): Box {
	return { minX: box.minX + dx, maxX: box.maxX + dx, minY: box.minY + dy, maxY: box.maxY + dy };
}

export function pointOnWire(x: number, y: number, raw: unknown): boolean {
	if (!Array.isArray(raw))
		throw new Error('GEOMETRY_UNAVAILABLE: 导线坐标不可用');
	const points = (Array.isArray(raw[0]) ? raw.flat() : raw) as number[];
	if (points.length < 4 || points.length % 2 || !points.every(Number.isFinite))
		throw new Error('GEOMETRY_UNAVAILABLE: 导线坐标格式非法');
	for (let i = 0; i + 3 < points.length; i += 2) {
		const [ax, ay, bx, by] = points.slice(i, i + 4);
		const dx = bx - ax;
		const dy = by - ay;
		const length2 = dx * dx + dy * dy;
		const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
		if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= 0.01)
			return true;
	}
	return false;
}

/** Follow wire endpoints and T junctions; do not infer a junction at plain crossings. */
export function connectedWires(x: number, y: number, lines: unknown[]): Set<number> {
	const connected = new Set<number>();
	const queue: number[] = [];
	for (const [index, line] of lines.entries()) {
		if (pointOnWire(x, y, line)) {
			connected.add(index);
			queue.push(index);
		}
	}
	const points = lines.map(line => Array.isArray(line) ? (Array.isArray(line[0]) ? line.flat() : line) as number[] : []);
	for (let head = 0; head < queue.length; head++) {
		const current = queue[head];
		for (let next = 0; next < lines.length; next++) {
			if (connected.has(next))
				continue;
			const touches = (a: number[], b: unknown): boolean => {
				for (let i = 0; i < a.length; i += 2) {
					if (pointOnWire(a[i], a[i + 1], b))
						return true;
				}
				return false;
			};
			if (touches(points[current], lines[next]) || touches(points[next], lines[current])) {
				connected.add(next);
				queue.push(next);
			}
		}
	}
	return connected;
}

/** Includes wires and labels: a free component origin is not necessarily a safe placement. */
export async function readObstacles(excludeId?: string | ReadonlySet<string>): Promise<Obstacle[]> {
	// A schematic page also exposes its sheet/title block and net markers via
	// PrimitiveComponent.  Those objects are not placeable parts and some of
	// them deliberately do not implement a geometric bounding box.  Asking for
	// every component therefore made a title block prevent *all* safe placement.
	// Request physical parts explicitly; their geometry remains mandatory.
	// The bridge's ambient SDK declaration is older than the runtime API and
	// narrows this optional enum argument to undefined.  `part` is the SDK's
	// documented ESCH_PrimitiveComponentType.COMPONENT runtime value.
	const parts = await eda.sch_PrimitiveComponent.getAll('part' as never, false);
	const primitives = [
		...parts,
		...(await eda.sch_PrimitiveComponent.getAll(undefined, false)).filter(component => ['netflag', 'netport'].includes(component.getState_ComponentType())),
		...await readSchematicWires(),
		...await eda.sch_PrimitiveAttribute.getAll(),
	];
	const obstacles: Obstacle[] = [];
	for (const primitive of primitives) {
		const id = primitive.getState_PrimitiveId();
		if (typeof excludeId === 'string' ? id === excludeId : excludeId?.has(id))
			continue;
		// Component attributes are already included in their component bbox.
		if ('getState_ParentPrimitiveId' in primitive && primitive.getState_ParentPrimitiveId())
			continue;
		if ('getState_Line' in primitive) {
			obstacles.push(...wireObstacles(id, primitive.getState_Line(), (primitive as any).getState_LineWidth?.() ?? 0));
		}
		else if ('getState_ComponentType' in primitive && primitive.getState_ComponentType() === 'part') {
			obstacles.push({ id, box: (await readComponentGeometry(primitive, id)).box });
		}
		else obstacles.push({ id, box: await reliableOrConservativeBox(primitive, id) });
	}
	return obstacles;
}
