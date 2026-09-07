import type { Box } from './layout-safety';
import { unionBoxes, translateBox, overlaps, obstacleOverlaps } from './layout-safety';
import { wiresTouch } from './net-lead';

export const ROWS = ['switch', 'capacitor', 'crystal', 'resistor', 'connector', 'ic', 'other'] as const;
export type Row = typeof ROWS[number];
export interface Point { x: number; y: number }
export interface RowPin extends Point { number: string; angle: number; net: string }
export interface RowText { id: string; box: Box }
export interface RowPart { id: string; ref: string; row: Row; body: Box; pins: RowPin[]; attributes: RowText[] }
export interface Route { pin: string; net: string; line: Point[]; label: Box }
export interface Cell extends RowPart { routes: Route[]; envelope: Box }
export interface RowPlacement extends Cell { x: number; y: number; page: number }
const pointBox = (p: Point): Box => ({ minX: p.x, maxX: p.x, minY: p.y, maxY: p.y });
const width = (b: Box) => b.maxX - b.minX;
const height = (b: Box) => b.maxY - b.minY;
const snap = (n: number) => Math.ceil(n / 10) * 10;
export function classifyRow(ref: string, name = '', explicit?: unknown): Row {
	if (explicit !== undefined) {
		if (!ROWS.includes(explicit as Row)) throw new Error('INVALID_ROW');
		return explicit as Row;
	}
	if (/usb|header|connector|母座|排针/i.test(name)) return 'connector';
	if (/^SW/i.test(ref)) return 'switch';
	if (/^C\d/i.test(ref)) return 'capacitor';
	if (/^[XY]\d/i.test(ref)) return 'crystal';
	if (/^[RL]\d/i.test(ref)) return 'resistor';
	if (/^[PJ]\d/i.test(ref)) return 'connector';
	if (/^U\d/i.test(ref)) return 'ic';
	return 'other';
}
/** All geometry is screen coordinates. Native rotation is done BEFORE this function. */
export function makeRowCell(part: RowPart, font = 10): Cell {
	if (!Number.isFinite(font) || font < 8 || font > 16) throw new Error('INVALID_FONT');
	if (!ROWS.includes(part.row) || !part.pins.every(p => [p.x, p.y, p.angle].every(Number.isFinite) && [0, 90, 180, 270].includes(p.angle))) throw new Error('UNSUPPORTED_PIN_GEOMETRY');
	const routes: Route[] = [];
	for (const angle of [0, 90, 180, 270]) {
		const horizontal = angle === 0 || angle === 180;
		const sign = angle === 0 || angle === 270 ? 1 : -1;
		const axis = (p: Point) => horizontal ? p.y : p.x;
		const pins = part.pins.filter(p => p.net && p.angle === angle).sort((a, b) => axis(a) - axis(b));
		const targets = pins.map(axis), mid = Math.floor((pins.length - 1) / 2), pitch = snap(font + 6);
		for (let i = mid - 1; i >= 0; i--) targets[i] = Math.min(targets[i], targets[i + 1] - pitch);
		for (let i = mid + 1; i < targets.length; i++) targets[i] = Math.max(targets[i], targets[i - 1] + pitch);
		pins.forEach((p, i) => {
			// Reserve a full font-width per glyph. Actual native text is measured later.
			const w = [...p.net].length * font, length = snap(Math.max(40, w + 12));
			const depth = 20 + Math.min(i, pins.length - 1 - i) * 10;
			const distance = 20 + Math.floor((pins.length - 1) / 2) * 10 + length;
			const end = horizontal ? { x: p.x + sign * distance, y: targets[i] } : { x: targets[i], y: p.y + sign * distance };
			const line: Point[] = [{ x: p.x, y: p.y }];
			if (targets[i] !== axis(p)) line.push(horizontal ? { x: p.x + sign * depth, y: p.y } : { x: p.x, y: p.y + sign * depth }, horizontal ? { x: p.x + sign * depth, y: targets[i] } : { x: targets[i], y: p.y + sign * depth });
			line.push(end);
			const x = horizontal ? (sign > 0 ? end.x - w - 3 : end.x + 3) : end.x + 2;
			const y = horizontal ? end.y + 2 : (sign > 0 ? end.y - w - 3 : end.y + 3);
			routes.push({ pin: p.number, net: p.net, line, label: { minX: x, maxX: x + (horizontal ? w : font), minY: y, maxY: y + (horizontal ? font : w) } });
		});
	}
	const raw = unionBoxes([part.body, ...part.pins.map(pointBox), ...routes.flatMap(r => [...r.line.map(pointBox), r.label])]);
	let y = raw.minY - 12;
	const attributes = [...part.attributes].reverse().map(a => {
		y -= height(a.box);
		const box = { minX: raw.minX, maxX: raw.minX + width(a.box), minY: y, maxY: y + height(a.box) };
		y -= 4; return { ...a, box };
	});
	return { ...part, attributes, routes, envelope: unionBoxes([raw, ...attributes.map(a => a.box)]) };
}
export function planTypeRows(parts: RowPart[], options: { width?: number; height?: number; font?: number } = {}): RowPlacement[] {
	const pageWidth = options.width ?? 1000, pageHeight = options.height ?? 600;
	if (![pageWidth, pageHeight].every(n => Number.isFinite(n) && n >= 300 && n <= 10000)) throw new Error('INVALID_PAGE_SIZE');
	let x = 0, y = 0, rowHeight = 0, page = 0;
	const result: RowPlacement[] = [];
	for (const category of ROWS) {
		if (x) { y += rowHeight + 60; x = 0; rowHeight = 0; }
		for (const part of parts.filter(p => p.row === category).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }))) {
			const cell = makeRowCell(part, options.font), w = snap(width(cell.envelope) + 10), h = snap(height(cell.envelope) + 10);
			if (w > pageWidth || h > pageHeight) throw new Error(`PAGE_TOO_SMALL: ${part.ref} requires ${w}x${h}`);
			if (x && x + w > pageWidth) { y += rowHeight + 60; x = 0; rowHeight = 0; }
			if (y + h > pageHeight) { page++; x = 0; y = 0; rowHeight = 0; }
			const dx = snap(x - cell.envelope.minX), dy = snap(y - cell.envelope.minY);
			const move = (b: Box) => translateBox(b, dx, dy);
			result.push({ ...cell, page, x: dx, y: dy, body: move(cell.body), envelope: move(cell.envelope), pins: cell.pins.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })), attributes: cell.attributes.map(a => ({ ...a, box: move(a.box) })), routes: cell.routes.map(r => ({ ...r, label: move(r.label), line: r.line.map(p => ({ x: p.x + dx, y: p.y + dy })) })) });
			x += w + 40; rowHeight = Math.max(rowHeight, h);
		}
	}
	return result;
}
/** Fail closed for untested symbols, including corner fanout interference. */
export function auditRows(cells: RowPlacement[]): string[] {
	const conflicts: string[] = [];
	for (const page of new Set(cells.map(c => c.page))) {
		const local = cells.filter(c => c.page === page);
		const routes = local.flatMap(c => c.routes.map(r => ({ ...r, id: `${c.id}.${r.pin}` })));
		const labels = local.flatMap(c => [...c.attributes.map(a => a.box), ...c.routes.map(r => r.label)]);
		const hits = (line: Point[], b: Box) => line.slice(1).some((q, i) => obstacleOverlaps({ minX: b.minX + 0.01, maxX: b.maxX - 0.01, minY: b.minY + 0.01, maxY: b.maxY - 0.01 }, { id: '', box: b, segment: [line[i].x, line[i].y, q.x, q.y] }, 0));
		for (let i = 0; i < local.length; i++) for (let j = i + 1; j < local.length; j++) if (overlaps(local[i].envelope, local[j].envelope, 0)) conflicts.push('cellOverlap');
		for (let i = 0; i < routes.length; i++) {
			const r = routes[i];
			for (let j = i + 1; j < routes.length; j++) if (r.net !== routes[j].net && wiresTouch(r.line.flatMap(p => [p.x, p.y]), routes[j].line.flatMap(p => [p.x, p.y]))) conflicts.push('wireCrossing');
			for (const c of local) {
				if (hits(r.line, c.body)) conflicts.push('wireBody');
				for (const p of c.pins) if (`${c.id}.${p.number}` !== r.id && p.net !== r.net && wiresTouch(r.line.flatMap(p => [p.x, p.y]), [p.x, p.y, p.x, p.y])) conflicts.push('wirePin');
			}
			for (const b of labels) if (hits(r.line, b)) conflicts.push('wireText');
		}
		for (let i = 0; i < labels.length; i++) {
			for (let j = i + 1; j < labels.length; j++) if (overlaps(labels[i], labels[j], -0.01)) conflicts.push('textOverlap');
			for (const c of local) if (overlaps(labels[i], c.body, -0.01)) conflicts.push('textBody');
		}
	}
	return conflicts;
}
