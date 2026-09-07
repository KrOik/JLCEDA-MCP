import { readMeasuredBox, type Box } from './layout-safety';

export function parseSourceAttributes(source: string, page: string) {
	let document: string | undefined;
	const attrs: Array<{ id: string; parent: string; key: string; visible: boolean }> = [];
	for (const line of source.split('\n').filter(l => l.trim())) {
		const split = line.indexOf('||');
		if (split < 0) throw new Error('UNSUPPORTED_DOCUMENT_SOURCE');
		const header = JSON.parse(line.slice(0, split));
		const data = JSON.parse(line.slice(split + 2).replace(/\|\s*$/, ''));
		if (header.type === 'DOCHEAD') document = data.uuid;
		if (header.type === 'ATTR') attrs.push({ id: header.id, parent: data.parentId, key: data.key, visible: data.valueVisible === true || data.keyVisible === true });
	}
	if (document !== page) throw new Error('DOCUMENT_CHANGED');
	return attrs;
}
/** getAll() omits live NET attributes in Pro; source IDs + get(id) are authoritative. */
export async function readNativeAttributes(page: string, parent?: string) {
	const source = await eda.sys_FileManager.getDocumentSource();
	if (!source) throw new Error('ATTRIBUTE_SOURCE_UNAVAILABLE');
	const attrs = parseSourceAttributes(source, page).filter(a => a.visible && (!parent || a.parent === parent));
	const result = [];
	for (const a of attrs) {
		const native = await eda.sch_PrimitiveAttribute.get(a.id);
		const box = await readMeasuredBox(native, a.id);
		if (!native || !box) throw new Error(`ATTRIBUTE_GEOMETRY_UNAVAILABLE: ${a.id}`);
		if (box.maxX > box.minX && box.maxY > box.minY) result.push({ ...a, native, box });
	}
	return result;
}
/** modify uses upward Y / inches for font; getter uses downward Y / native font units. */
export async function positionNativeAttribute(id: string, target: Box, check: () => Promise<void>, font?: number, rotation?: number) {
	let native = await eda.sch_PrimitiveAttribute.get(id);
	if (!native) throw new Error('ATTRIBUTE_MISSING');
	if (font !== undefined || rotation !== undefined) {
		await check();
		await eda.sch_PrimitiveAttribute.modify(id, { ...(font === undefined ? {} : { fontSize: font / 100 }), ...(rotation === undefined ? {} : { rotation }) });
	}
	for (let attempt = 0; attempt < 3; attempt++) {
		native = await eda.sch_PrimitiveAttribute.get(id);
		const b = await readMeasuredBox(native, id);
		if (!native || !b) throw new Error('ATTRIBUTE_GEOMETRY_UNAVAILABLE');
		const dx = target.minX - b.minX, dy = target.maxY - b.maxY;
		if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
			if (b.maxX > target.maxX + 0.1 || b.minY < target.minY - 0.1) throw new Error(`TEXT_EXCEEDS_ENVELOPE: ${id}`);
			return b;
		}
		const x = native.getState_X(), y = native.getState_Y();
		if (x === null || y === null) throw new Error('ATTRIBUTE_POSITION_UNAVAILABLE');
		await check();
		await eda.sch_PrimitiveAttribute.modify(id, { x: x + dx, y: -y + dy });
	}
	throw new Error(`ATTRIBUTE_POSITION_UNCONFIRMED: ${id}`);
}
