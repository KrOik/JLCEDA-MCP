/** Recover the live wire list when the SDK index contains stale primitive IDs. */
export async function readSchematicWires() {
	const api = eda.sch_PrimitiveWire;
	const wires = await api.getAll();
	if (typeof api.getAllPrimitiveId !== 'function') return wires;
	const indexedIds = await api.getAllPrimitiveId();
	if (indexedIds.length === wires.length && indexedIds.every(id => wires.some(w => w.getState_PrimitiveId() === id)))
		return wires;
	// Live Wire.modify(string, ...) left phantom index IDs: getAll returned []
	// while get(realId) and document source still contained the original wires.
	const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	const source = await eda.sys_FileManager.getDocumentSource();
	if (!page || !source) throw new Error('GEOMETRY_UNAVAILABLE: 导线索引不一致且无文档源码');
	const ids: string[] = [];
	let documentId: string | undefined;
	for (const line of source.split('\n')) {
		if (!line.trim()) continue;
		const separator = line.indexOf('||');
		if (separator < 0) throw new Error('GEOMETRY_UNAVAILABLE: 未识别文档源码格式');
		const header = JSON.parse(line.slice(0, separator));
		if (header.type === 'DOCHEAD') documentId = JSON.parse(line.slice(separator + 2).replace(/\|\s*$/, '')).uuid;
		if (header.type === 'WIRE') {
			if (typeof header.id !== 'string' || !header.id) throw new Error('GEOMETRY_UNAVAILABLE: 导线 ID 缺失');
			ids.push(header.id);
		}
	}
	if (documentId !== page.uuid || (await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page.uuid)
		throw new Error('DOCUMENT_CHANGED: 导线源码不属于当前页');
	const result: typeof wires = [];
	for (let offset = 0; offset < ids.length; offset += 50) {
		const batch = ids.slice(offset, offset + 50);
		const found = await api.get(batch);
		if (!Array.isArray(found) || found.length !== batch.length || batch.some(id => !found.some(w => w.getState_PrimitiveId() === id)))
			throw new Error('GEOMETRY_UNAVAILABLE: 无法完整回读真实导线');
		result.push(...found);
	}
	if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page.uuid) throw new Error('DOCUMENT_CHANGED');
	return result;
}
/** Native getState_Line may concatenate independent segments, not a continuous path. */
export function parseNativeWireObstacles(source: string, page: string) {
	let document: string | undefined;
	const ids = new Set<string>();
	const segments: Array<{ group: string; segment: [number, number, number, number]; halfWidth: number }> = [];
	for (const line of source.split('\n').filter(s => s.trim())) {
		const split = line.indexOf('||');
		if (split < 0) throw new Error('UNSUPPORTED_DOCUMENT_SOURCE');
		const header = JSON.parse(line.slice(0, split)), data = JSON.parse(line.slice(split + 2).replace(/\|\s*$/, ''));
		if (header.type === 'DOCHEAD') document = data.uuid;
		if (header.type === 'WIRE') ids.add(header.id);
		if (header.type === 'LINE' && typeof data.lineGroup === 'string') {
			const points = [data.startX, -data.startY, data.endX, -data.endY] as [number, number, number, number];
			if (![data.startX, data.startY, data.endX, data.endY].every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('INVALID_NATIVE_WIRE_SEGMENT');
			const width = data.strokeWidth ?? 1;
			if (typeof width !== 'number' || !Number.isFinite(width) || width < 0) throw new Error('INVALID_NATIVE_WIRE_WIDTH');
			segments.push({ group: data.lineGroup, segment: points, halfWidth: width / 2 });
		}
	}
	if (document !== page) throw new Error('DOCUMENT_CHANGED');
	if ([...ids].some(id => !segments.some(s => s.group === id))) throw new Error('WIRE_SEGMENTS_UNAVAILABLE');
	return segments.filter(s => ids.has(s.group)).map(s => ({ id: s.group, segment: s.segment, halfWidth: s.halfWidth, box: { minX: Math.min(s.segment[0], s.segment[2]), maxX: Math.max(s.segment[0], s.segment[2]), minY: Math.min(s.segment[1], s.segment[3]), maxY: Math.max(s.segment[1], s.segment[3]) } }));
}
export async function readNativeWireObstacles(page: string) {
	const source = await eda.sys_FileManager.getDocumentSource();
	if (!source) throw new Error('WIRE_SOURCE_UNAVAILABLE');
	const result = parseNativeWireObstacles(source, page);
	if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page) throw new Error('DOCUMENT_CHANGED');
	return result;
}
