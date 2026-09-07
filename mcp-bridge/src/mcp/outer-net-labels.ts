import { readNativeAttributes, positionNativeAttribute } from './native-attributes';
import { obstacleOverlaps, readObstacles, type Box, type Obstacle } from './layout-safety';
import { pointOnWire } from './layout-safety';
import { readNativeWireObstacles } from './schematic-wire-reader';

/** Reserve text beside the OUTERMOST straight segment, beyond every elbow. */
export function outerLabelCandidates(line: number[], textWidth: number, font = 10): Box[] {
	if (line.length < 4 || line.length % 2 || !line.every(Number.isFinite) || !Number.isFinite(textWidth) || textWidth <= 0 || !Number.isFinite(font) || font <= 0) throw new Error('INVALID_LABEL_GEOMETRY');
	const [sx, sy, x, y] = line.slice(-4), horizontal = sy === y;
	if ((sx === x) === horizontal) throw new Error('INVALID_FINAL_SEGMENT');
	if (Math.abs(x - sx) + Math.abs(y - sy) < textWidth + 6) throw new Error('LABEL_LEAD_TOO_SHORT');
	if (horizontal) {
		const left = x > sx ? x - textWidth - 3 : x + 3;
		return [{ minX: left, maxX: left + textWidth, minY: y - font - 2, maxY: y - 2 }, { minX: left, maxX: left + textWidth, minY: y + 2, maxY: y + font + 2 }];
	}
	const bottom = y > sy ? y - textWidth - 3 : y + 3;
	return [{ minX: x + 2, maxX: x + font + 2, minY: bottom, maxY: bottom + textWidth }, { minX: x - font - 2, maxX: x - 2, minY: bottom, maxY: bottom + textWidth }];
}
export function chooseOuterLabelBox(line: number[], width: number, obstacles: Obstacle[], font = 10): Box {
	const target = outerLabelCandidates(line, width, font).find(box => !obstacles.some(o => obstacleOverlaps(box, o, 0.5)));
	if (!target) throw new Error('LABEL_COLLISION: 外侧网名区两侧均被占用，请增加器件间距或重新布局');
	return target;
}
export interface OuterLabelRoute { primitiveId: string; netName: string; line: number[]; target: Box }
/** Call AFTER the complete wire batch and DRC refresh; never move existing user labels. */
export async function placeOuterNetLabels(page: string, routes: OuterLabelRoute[], check: () => Promise<void>) {
	await check();
	const attrs = await readNativeAttributes(page);
	const selected = [];
	for (const route of routes) {
		const matches = attrs.filter(a => a.key === 'NET' && a.parent === route.primitiveId && a.native.getState_Value() === route.netName);
		if (matches.length !== 1) throw new Error(`NET_LABEL_UNAVAILABLE: ${route.primitiveId}`);
		const raw = await eda.sch_PrimitiveWire.get(route.primitiveId);
		const wire = Array.isArray(raw) ? raw[0] : raw;
		if (!wire || wire.getState_Net() !== route.netName || !pointOnWire(route.line[0], route.line[1], wire.getState_Line())) throw new Error('NET_LABEL_PARENT_UNCONFIRMED');
		selected.push({ route, attribute: matches[0] });
	}
	const ids = new Set(selected.map(s => s.attribute.id));
	if (ids.size !== selected.length) throw new Error('NET_LABEL_SHARED: merged wires require a combined layout, not independent labels');
	const obstacles = (await readObstacles(ids)).filter(o => !o.segment);
	obstacles.push(...await readNativeWireObstacles(page));
	// Source enumeration includes NET attributes missing from the SDK's getAll index.
	obstacles.push(...attrs.filter(a => !ids.has(a.id)).map(a => ({ id: a.id, box: a.box })));
	const result = [];
	for (const { route, attribute } of selected) {
		await check();
		const width = route.target.maxX - route.target.minX, height = route.target.maxY - route.target.minY;
		const horizontal = route.line.at(-1) === route.line.at(-3);
		// Keep the reserved region conservative; native readback must fit, never silently shrink text.
		let target = route.target;
		if (obstacles.some(o => obstacleOverlaps(target, o, 0.5))) target = chooseOuterLabelBox(route.line, horizontal ? width : height, obstacles);
		const measured = await positionNativeAttribute(attribute.id, target, check, 10, horizontal ? 0 : 90);
		if (obstacles.some(o => obstacleOverlaps(measured, o, 0.5))) throw new Error('LABEL_COLLISION_AFTER_READBACK');
		obstacles.push({ id: attribute.id, box: measured });
		result.push({ primitiveId: route.primitiveId, attributeId: attribute.id, box: measured });
	}
	await check();
	return result;
}
