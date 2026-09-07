import type { Box, Obstacle } from './layout-safety';
import ELK from 'elkjs/lib/elk.bundled.js';
import { obstacleOverlaps, translateBox, unionBoxes } from './layout-safety';

export interface LayoutPart {
	id: string;
	group: string;
	box: Box; // Relative to the actual component anchor, not the visual center.
	ports: Array<{ pinNumber: string; x: number; y: number }>;
	nets: Record<string, string>;
}
export interface LayoutOptions {
	mode: 'compact' | 'elk';
	startX: number;
	startY: number;
	grid: number;
	gap: number;
	groupGap: number;
	padding: number;
	columns: number;
	maxRadius: number;
	weakNets: string[];
}
export interface LayoutPosition { id: string; x: number; y: number }

/** Bounded, deterministic local search. Never throws a part to the global right edge. */
export function findLocalPosition(relativeBox: Box, desired: { x: number; y: number }, obstacles: Obstacle[], gap: number, grid: number, maxRadius: number): { x: number; y: number } | undefined {
	const x = Math.round(desired.x / grid) * grid;
	const y = Math.round(desired.y / grid) * grid;
	const free = (dx: number, dy: number) => !obstacles.some(o => obstacleOverlaps(translateBox(relativeBox, x + dx, y + dy), o, gap));
	if (free(0, 0))
		return { x, y };
	for (let r = grid; r <= maxRadius; r += grid) {
		for (let d = -r; d <= r; d += grid) {
			for (const [dx, dy] of [[d, -r], [d, r], [-r, d], [r, d]]) {
				if (free(dx, dy))
					return { x: x + dx, y: y + dy };
			}
		}
	}
	return undefined;
}

function pack(parts: LayoutPart[], options: LayoutOptions): LayoutPosition[] {
	const positions: LayoutPosition[] = [];
	let left = options.padding;
	let top = options.padding;
	let rowHeight = 0;
	for (const [i, part] of parts.entries()) {
		if (i && i % options.columns === 0) {
			left = options.padding;
			top += rowHeight + options.gap + options.grid;
			rowHeight = 0;
		}
		const x = Math.ceil((left - part.box.minX) / options.grid) * options.grid;
		const y = Math.ceil((top - part.box.minY) / options.grid) * options.grid;
		positions.push({ id: part.id, x, y });
		left = x + part.box.maxX + options.gap + options.grid;
		rowHeight = Math.max(rowHeight, y + part.box.maxY - top);
	}
	return positions;
}

async function elkPositions(parts: LayoutPart[], options: LayoutOptions): Promise<LayoutPosition[]> {
	const weak = new Set(options.weakNets.map(n => n.toUpperCase()));
	const members = new Map<string, string[]>();
	const children = parts.map((p, i) => {
		const width = Math.max(1, p.box.maxX - p.box.minX);
		const height = Math.max(1, p.box.maxY - p.box.minY);
		return { id: p.id, width, height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }, ports: p.ports.map((port, j) => {
			const id = `port-${i}-${j}`;
			const net = p.nets[port.pinNumber];
			if (net && !weak.has(net.toUpperCase()))
				members.set(net, [...(members.get(net) ?? []), id]);
			// ELK Y grows downwards; EDA Y grows upwards.
			const x = port.x - p.box.minX;
			const y = p.box.maxY - port.y;
			const sides = [{ side: 'WEST', distance: x }, { side: 'EAST', distance: width - x }, { side: 'NORTH', distance: y }, { side: 'SOUTH', distance: height - y }];
			const side = sides.sort((a, b) => a.distance - b.distance)[0].side;
			return { id, x, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } };
		}) };
	});
	const edges = [...members.entries()].flatMap(([net, ports], i) => ports.slice(1).map((port, j) => ({ id: `net-${i}-${j}`, sources: [ports[0]], targets: [port], labels: [], net })));
	const elk = new ELK();
	try {
		const graph = await elk.layout({ id: 'root', layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.spacing.nodeNode': String(options.gap + options.grid),
			'elk.layered.spacing.nodeNodeBetweenLayers': String(options.gap + options.grid),
			'elk.spacing.componentComponent': String(options.gap + options.grid),
			'elk.padding': `[top=${options.padding},left=${options.padding},bottom=${options.padding},right=${options.padding}]`,
			'elk.randomSeed': '1',
		}, children, edges });
		return (graph.children ?? []).map((node) => {
			const part = parts.find(p => p.id === node.id)!;
			if (!Number.isFinite(node.x) || !Number.isFinite(node.y))
				throw new Error('ELK_LAYOUT_FAILED: 坐标缺失');
			return { id: node.id, x: node.x! - part.box.minX, y: -(node.y! + (node.height ?? 0)) - part.box.minY };
		});
	}
	finally {
		// The bundled in-process worker has no terminate method in ELK 0.9.
		try {
			elk.terminateWorker();
		}
		catch { /* No external worker was allocated; let the local instance be collected. */ }
	}
}

/** Lay out each functional group, legalize snapped positions, then pack whole groups. */
export async function planSchematicLayout(parts: LayoutPart[], obstacles: Obstacle[], options: LayoutOptions) {
	const groups = new Map<string, LayoutPart[]>();
	for (const part of parts) groups.set(part.group, [...(groups.get(part.group) ?? []), part]);
	const positions: LayoutPosition[] = [];
	const groupBounds: Array<{ id: string; box: Box }> = [];
	const occupied = [...obstacles];
	let cursorX = options.startX;
	let cursorY = options.startY;
	let rowHeight = 0;
	for (const [groupId, groupParts] of groups) {
		if (groupBounds.length && groupBounds.length % options.columns === 0) {
			cursorX = options.startX;
			cursorY -= rowHeight + options.groupGap + options.grid;
			rowHeight = 0;
		}
		const proposed = options.mode === 'elk' ? await elkPositions(groupParts, options) : pack(groupParts, options);
		const local: Obstacle[] = [];
		const legalized = proposed.map((position) => {
			const part = groupParts.find(p => p.id === position.id)!;
			const safe = findLocalPosition(part.box, position, local, options.gap, options.grid, options.maxRadius);
			if (!safe)
				throw new Error(`LAYOUT_NO_SPACE: 功能块 ${groupId} 内无可用位置`);
			local.push({ id: part.id, box: translateBox(part.box, safe.x, safe.y) });
			return { id: part.id, ...safe };
		});
		const bounds = unionBoxes(local.map(o => o.box));
		const padded = { minX: bounds.minX - options.padding, minY: bounds.minY - options.padding, maxX: bounds.maxX + options.padding, maxY: bounds.maxY + options.padding };
		const shift = findLocalPosition(padded, { x: cursorX - padded.minX, y: cursorY - padded.maxY }, occupied, options.groupGap, options.grid, options.maxRadius);
		if (!shift)
			throw new Error(`LAYOUT_NO_SPACE: 功能块 ${groupId} 周围无可用空间`);
		positions.push(...legalized.map(p => ({ id: p.id, x: p.x + shift.x, y: p.y + shift.y })));
		const box = translateBox(padded, shift.x, shift.y);
		groupBounds.push({ id: groupId, box });
		occupied.push({ id: `group:${groupId}`, box });
		cursorX = box.maxX + options.groupGap + options.grid;
		rowHeight = Math.max(rowHeight, box.maxY - box.minY);
	}
	return { positions, groups: groupBounds, mode: options.mode };
}
