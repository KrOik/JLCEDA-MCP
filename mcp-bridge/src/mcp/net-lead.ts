import { pointOnWire } from './layout-safety';

export interface LeadPoint { x: number; y: number }

/** Independent, deterministic fanout in native (upward Y) coordinates. */
export function staircaseLeads(pins: Array<LeadPoint & { rotation: number }>, length = 80, pitch = 20): number[][] {
	if (!pins.every(p => [p.x, p.y, p.rotation].every(Number.isFinite))) throw new Error('INVALID_PIN_COORDINATES');
	if (!Number.isFinite(length) || length < 30 || length > 1000 || !Number.isFinite(pitch) || pitch < 20 || pitch > 200 || pitch % 10) throw new Error('INVALID_FANOUT_OPTIONS');
	const result: number[][] = pins.map(p => netLead(p.x, p.y, p.rotation, length));
	for (const rotation of [0, 90, 180, 270]) {
		const horizontal = rotation === 0 || rotation === 180;
		const dx = rotation === 0 ? 1 : rotation === 180 ? -1 : 0, dy = rotation === 90 ? 1 : rotation === 270 ? -1 : 0;
		const group = pins.map((p, index) => ({ ...p, index })).filter(p => ((p.rotation % 360) + 360) % 360 === rotation).sort((a, b) => horizontal ? a.y - b.y : a.x - b.x);
		const targets = group.map(p => horizontal ? p.y : p.x), mid = Math.floor((group.length - 1) / 2);
		for (let i = mid - 1; i >= 0; i--) targets[i] = Math.min(targets[i], targets[i + 1] - pitch);
		for (let i = mid + 1; i < group.length; i++) targets[i] = Math.max(targets[i], targets[i - 1] + pitch);
		group.forEach((p, i) => {
			const depth = 20 + Math.min(i, group.length - 1 - i) * 10;
			const distance = length + 20 + Math.floor((group.length - 1) / 2) * 10;
			const end = horizontal ? [p.x + dx * distance, targets[i]] : [targets[i], p.y + dy * distance];
			result[p.index] = targets[i] === (horizontal ? p.y : p.x) ? [p.x, p.y, ...end] : [p.x, p.y, p.x + dx * depth, p.y + dy * depth, horizontal ? p.x + dx * depth : targets[i], horizontal ? targets[i] : p.y + dy * depth, ...end];
		});
	}
	return result;
}

/** Pin rotations use EDA coordinates, already normalized by getAllPinsByPrimitiveId. */
export function netLead(x: number, y: number, rotation: number, length: number): number[] {
	const angle = ((rotation % 360) + 360) % 360;
	if (![0, 90, 180, 270].includes(angle)) throw new Error('不支持斜向引脚，请使用 Escape Hatch 指定原生导线路径');
	const dx = angle === 0 ? 1 : angle === 180 ? -1 : 0;
	const dy = angle === 90 ? 1 : angle === 270 ? -1 : 0;
	return [x, y, x + dx * length, y + dy * length];
}

export function wireSegments(raw: unknown): number[][] {
	if (!Array.isArray(raw)) throw new Error('导线路径不可用');
	const values = (Array.isArray(raw[0]) ? raw.flat() : raw) as number[];
	if (values.length < 4 || values.length % 2 || !values.every(Number.isFinite)) throw new Error('导线路径格式错误');
	return Array.from({ length: values.length / 2 - 1 }, (_, i) => values.slice(i * 2, i * 2 + 4));
}

/** Conservative crossing rejection; no implicit junctions with another net. */
export function wiresTouch(a: unknown, b: unknown): boolean {
	for (const aa of wireSegments(a)) for (const bb of wireSegments(b)) {
		if (pointOnWire(aa[0], aa[1], bb) || pointOnWire(aa[2], aa[3], bb)
			|| pointOnWire(bb[0], bb[1], aa) || pointOnWire(bb[2], bb[3], aa)) return true;
		const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		if (cross(...aa as [number, number, number, number], bb[0], bb[1]) * cross(...aa as [number, number, number, number], bb[2], bb[3]) < 0
			&& cross(...bb as [number, number, number, number], aa[0], aa[1]) * cross(...bb as [number, number, number, number], aa[2], aa[3]) < 0) return true;
	}
	return false;
}
