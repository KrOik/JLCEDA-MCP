import { assertExecutionDeadline } from '../runtime/execution-guard';
import { netLead, staircaseLeads, wiresTouch, wireSegments } from './net-lead';
import { isPlainObjectRecord, toSafeErrorMessage } from '../utils';
import { connectedWires, FALLBACK_COMPONENT_HALF_SIZE, obstacleOverlaps, overlaps, pointOnWire, readComponentGeometry, readObstacles, reliableOrConservativeBox, translateBox } from './layout-safety';
import { handleLayoutPlacement } from './layout-placement-handler';
import { findLocalPosition } from './schematic-layout';
import { readSchematicWires, readNativeWireObstacles } from './schematic-wire-reader';
import { reserveDesignators } from './designator-plan';
import { chooseOuterLabelBox, placeOuterNetLabels, type OuterLabelRoute } from './outer-net-labels';
import { readNativeAttributes } from './native-attributes';
import type { Box, Obstacle } from './layout-safety';

function record(value: unknown): Record<string, unknown> {
	if (!isPlainObjectRecord(value))
		throw new TypeError('参数必须为对象');
	return value;
}

function text(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim())
		throw new TypeError(`${field} 必须为非空字符串`);
	return value.trim();
}

function number(value: unknown, fallback: number): number {
	if (value === undefined)
		value = fallback;
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new TypeError('坐标及布局参数必须为有限数值');
	return value;
}

function batch(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 50)
		throw new TypeError('批量数量必须为 1-50');
	return value.map(record);
}

function boolean(value: unknown, fallback = false): boolean {
	if (value === undefined)
		return fallback;
	if (typeof value !== 'boolean')
		throw new TypeError('开关参数必须为 boolean');
	return value;
}

/** Some Pro API `get()` calls return a plain state snapshot, unlike create(). */
function stateValue(value: unknown, getter: string, property: string): unknown {
	// Pro API 0.2.8 wraps a single `get(id)` result in an array. Treat that
	// representation identically to an object state snapshot so a verified
	// placement is never downgraded to "unconfirmed" merely by serialization.
	if (Array.isArray(value) && value.length === 1)
		value = value[0];
	if (!value || typeof value !== 'object')
		return undefined;
	const record = value as Record<string, unknown>;
	const fn = record[getter];
	return typeof fn === 'function' ? fn.call(value) : record[property];
}

async function requireSchematic(): Promise<void> {
	if (!await eda.dmt_Schematic.getCurrentSchematicPageInfo())
		throw new Error('请先打开目标原理图页面');
}

/** Validate the entire plan before the first mutation; return IDs even on partial failure. */
export async function handleComponentPlaceAutoTask(payload: unknown): Promise<unknown> {
	const args = record(payload);
	const layout = args.layout === undefined ? {} : record(args.layout);
	const explicit = Array.isArray(args.components) && args.components.some(item => isPlainObjectRecord(item) && (item.x !== undefined || item.y !== undefined));
	const mode = layout.mode ?? (explicit || layout.spacingX !== undefined || layout.spacingY !== undefined ? 'grid' : 'compact');
	if (mode !== 'grid') return handleLayoutPlacement({ ...args, layout: { ...layout, mode } }, handlePinNetConfigureTask);
	const columns = number(layout.columns, 4);
	if (!Number.isInteger(columns) || columns < 1 || columns > 50)
		throw new TypeError('columns 必须为 1-50 的整数');
	const clearance = number(args.clearance, 20);
	if (clearance < 10)
		throw new TypeError('clearance 至少为 10 个 EDA 原生单位');
	const grid = number(layout.grid, 10);
	const maxRadius = number(layout.maxRadius, grid * 100);
	const leadLength = number(layout.leadLength, 80);
	if (leadLength < 30 || leadLength > 1000) throw new TypeError('leadLength 必须为 30..1000');
	if (grid <= 0 || maxRadius < grid || maxRadius / grid > 200)
		throw new TypeError('grid>0，maxRadius/grid 必须为 1..200');
	const defaultSpacing = FALLBACK_COMPONENT_HALF_SIZE * 2 + clearance + 100;
	const spacingX = number(layout.spacingX, defaultSpacing);
	const spacingY = number(layout.spacingY, defaultSpacing);
	if (spacingX <= 0 || spacingY <= 0)
		throw new TypeError('网格间距必须为正数');
	const plan = batch(args.components).map((item, index) => {
		const rotation = number(item.rotation, 0);
		if (![0, 90, 180, 270].includes(rotation))
			throw new TypeError('rotation 必须为 0/90/180/270');
		return {
			uuid: text(item.uuid, 'uuid'),
			designator: item.designator === undefined ? undefined : text(item.designator, 'designator'),
			nets: item.nets === undefined ? {} : Object.fromEntries(Object.entries(record(item.nets)).map(([pin, net]) => [text(pin, 'pinNumber'), text(net, 'netName')])),
			libraryUuid: text(item.libraryUuid, 'libraryUuid'),
			x: number(item.x, number(layout.startX, 0) + index % columns * spacingX),
			y: number(item.y, number(layout.startY, 0) + Math.floor(index / columns) * spacingY),
			rotation,
			mirror: boolean(item.mirror),
			subPartName: item.subPartName === undefined ? undefined : text(item.subPartName, 'subPartName'),
		};
	});
	if (plan.reduce((count, item) => count + Object.keys(item.nets).length, 0) > 50) throw new Error('单次放置并连接最多配置 50 个引脚，请按功能块拆分');
	const dryRun = boolean(args.dryRun);
	const coordinates = new Set<string>();
	for (const item of plan) {
		const key = `${item.x},${item.y}`;
		if (coordinates.has(key))
			throw new Error('LAYOUT_COLLISION: 批量器件坐标重复');
		coordinates.add(key);
	}
	await requireSchematic();
	const reservedDesignators = reserveDesignators(plan, (await eda.sch_PrimitiveComponent.getAll('part' as never, false)).map(component => String(stateValue(component, 'getState_Designator', 'designator') ?? '')));
	const obstacles = await readObstacles();
	if (dryRun) {
		return { ok: true, dryRun, mode: 'grid', layoutNotice: '已使用显式坐标/固定间距的 grid 布局，不是 compact/elk 紧凑布局。', plan, obstacles, geometryVerified: false, message: '只预览候选坐标；真实符号包围盒在隔离暂存位置创建后检查，通过后才移动到目标位置。' };
	}
	const results: Record<string, unknown>[] = [];
	const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	for (const [index, item] of plan.entries()) {
		let stagedId: string | undefined;
		let suggestedPosition: { x: number; y: number } | undefined;
		try {
			assertExecutionDeadline();
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid)
				throw new Error('DOCUMENT_CHANGED: 批量放置期间页面已切换');
			const currentObstacles = await readObstacles();
			const stagingX = Math.max(0, ...currentObstacles.map(value => value.box.maxX)) + 20000;
			const stagingY = Math.max(0, ...currentObstacles.map(value => value.box.maxY)) + 20000;
			const created = await eda.sch_PrimitiveComponent.create(
				{ uuid: item.uuid, libraryUuid: item.libraryUuid },
				stagingX,
				stagingY,
				item.subPartName,
				item.rotation,
				item.mirror,
				true,
				true,
			);
			if (!created)
				throw new Error('器件创建返回空结果');
			const primitiveIdValue = stateValue(created, 'getState_PrimitiveId', 'primitiveId');
			if (typeof primitiveIdValue !== 'string' || !primitiveIdValue)
				throw new Error('器件创建结果缺少图元 ID');
			const primitiveId = primitiveIdValue;
			stagedId = primitiveId;
			assertExecutionDeadline();
			const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
			if (!pins)
				throw new Error('GEOMETRY_UNAVAILABLE: 无法读取器件引脚');
			const geometry = await readComponentGeometry(created, primitiveId);
			const box = { ...geometry.box };
			// Explicitly include pin connection endpoints even if the SDK bbox omits them.
			for (const pin of pins) {
				const x = number(pin.getState_X(), Number.NaN);
				const y = number(pin.getState_Y(), Number.NaN);
				box.minX = Math.min(box.minX, x);
				box.maxX = Math.max(box.maxX, x);
				box.minY = Math.min(box.minY, y);
				box.maxY = Math.max(box.maxY, y);
				if (item.nets[pin.getState_PinNumber()]) {
					const line = netLead(x, y, number(stateValue(pin, 'getState_Rotation', 'rotation'), 0), leadLength);
					box.minX = Math.min(box.minX, line[2]);
					box.maxX = Math.max(box.maxX, line[2]);
					box.minY = Math.min(box.minY, line[3]);
					box.maxY = Math.max(box.maxY, line[3]);
				}
			}
			const targetBox = translateBox(box, item.x - stagingX, item.y - stagingY);
			const conflict = currentObstacles.find(obstacle => obstacleOverlaps(targetBox, obstacle, clearance));
			if (conflict) {
				suggestedPosition = findLocalPosition(translateBox(box, -stagingX, -stagingY), item, currentObstacles, clearance, grid, maxRadius);
				throw new Error(`LAYOUT_COLLISION: 与 ${conflict.id} 包围盒/引脚/导线间距不足，请调整坐标`);
			}
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid)
				throw new Error('DOCUMENT_CHANGED');
			// The live SDK leaves these blank/R? after create(); blank IDs collapse exported netlists.
			const existing = await eda.sch_PrimitiveComponent.getAll('part' as never, false);
			const usedDesignators = new Set(existing.filter(component => component.getState_PrimitiveId() !== primitiveId)
				.map(component => String(stateValue(component, 'getState_Designator', 'designator') ?? '').toUpperCase()));
			const originalDesignator = String(stateValue(created, 'getState_Designator', 'designator') ?? 'U?');
			if (item.designator && usedDesignators.has(item.designator.toUpperCase()))
				throw new Error(`DESIGNATOR_CONFLICT: ${item.designator} 已存在，请选择未使用的位号`);
			let designator = item.designator ?? originalDesignator;
			if (!item.designator && (!designator || designator.includes('?') || usedDesignators.has(designator.toUpperCase()) || reservedDesignators.has(designator.toUpperCase()))) {
				const prefix = originalDesignator.match(/^[A-Za-z]+/)?.[0] ?? 'U';
				let suffix = 1;
				while (usedDesignators.has(`${prefix}${suffix}`.toUpperCase()) || reservedDesignators.has(`${prefix}${suffix}`.toUpperCase())) suffix++;
				designator = `${prefix}${suffix}`;
			}
			const uniqueId = String(stateValue(created, 'getState_UniqueId', 'uniqueId') || primitiveId);
			assertExecutionDeadline();
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid)
				throw new Error('DOCUMENT_CHANGED');
			if (!await eda.sch_PrimitiveComponent.modify(primitiveId, { x: item.x, y: item.y, designator, uniqueId }))
				throw new Error('移动器件失败');
			const persisted = await eda.sch_PrimitiveComponent.get(primitiveId);
			const confirmed = stateValue(persisted, 'getState_X', 'x') === item.x
				&& stateValue(persisted, 'getState_Y', 'y') === item.y
				&& stateValue(persisted, 'getState_Designator', 'designator') === designator
				&& stateValue(persisted, 'getState_UniqueId', 'uniqueId') === uniqueId;
			results.push({ index, ...item, ok: confirmed, primitiveId, designator, uniqueId, clearance, collisionChecked: true, geometry: { source: geometry.source, measured: geometry.measured, box: targetBox }, executionState: confirmed ? 'confirmed' : 'unconfirmed' });
			if (!confirmed)
				break;
		}
		catch (error) {
			let cleanedUp = false;
			try {
				if (stagedId && (await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid === page?.uuid) {
					cleanedUp = await eda.sch_PrimitiveComponent.delete(stagedId);
				}
			}
			catch { /* Report the precise remaining ID; never delete pre-existing primitives. */ }
			results.push({ index, ...item, ok: false, error: toSafeErrorMessage(error), stagedId, cleanedUp, ...(suggestedPosition ? { suggestedPosition } : {}) });
			break; // Never replay successful mutations automatically.
		}
	}
	const placedAll = results.length === plan.length && results.every(item => item.ok);
	const assignments = results.flatMap((item, index) => Object.entries(plan[index].nets).map(([pinNumber, netName]) => ({ componentId: item.primitiveId, pinNumber, netName })));
	let connections: Record<string, unknown> | undefined;
	if (placedAll && assignments.length) {
		try { connections = await handlePinNetConfigureTask({ assignments, leadLength }) as Record<string, unknown>; }
		catch (error) { connections = { ok: false, error: toSafeErrorMessage(error), assignments, message: '器件已放置，不要重放 component_place；直接处理这些引脚连接。' }; }
	}
	return { ok: placedAll && connections?.ok !== false, mode: 'grid', layoutNotice: '已使用显式坐标/固定间距的 grid 布局，不是 compact/elk 紧凑布局。',
		...(connections?.escapeHatch ? { escapeHatch: JSON.parse(JSON.stringify(connections.escapeHatch)) } : {}),
		results, ...(connections ? { connections } : {}), total: plan.length, attempted: results.length,
		remainingIndices: plan.flatMap((_, index) => results[index]?.ok ? [] : [index]) };
}

/** Connect with named native wires at actual pin endpoints, then verify the exported netlist. */
export async function handlePinNetConfigureTask(payload: unknown): Promise<unknown> {
	const args = record(payload);
	const routing = args.routing ?? 'straight';
	if (!['straight', 'staircase'].includes(String(routing))) throw new Error('routing 必须为 straight/staircase');
	const netLabelPlacement = args.netLabelPlacement ?? (routing === 'staircase' ? 'outer' : 'native');
	if (!['native', 'outer'].includes(String(netLabelPlacement)) || (netLabelPlacement === 'outer' && routing !== 'staircase')) throw new Error('outer 网名区需要 routing=staircase');
	const lanePitch = number(args.lanePitch, 20);
	if (routing === 'staircase') staircaseLeads([], 80, lanePitch);
	const assignments = batch(args.assignments).map(item => ({
		componentId: text(item.componentId, 'componentId'),
		pinNumber: text(item.pinNumber, 'pinNumber'),
		netName: text(item.netName, 'netName'),
		terminal: item.terminal === undefined ? 'none' : text(item.terminal, 'terminal'),
	}));
	if (assignments.some(item => !['none', 'port', 'power', 'ground'].includes(item.terminal))) throw new Error('terminal 必须为 none/port/power/ground');
	const leadLength = number(args.leadLength, 80);
	if (leadLength < 30 || leadLength > 1000) throw new Error('leadLength 必须为 30..1000');
	const dryRun = boolean(args.dryRun);
	const keys = new Set<string>();
	await requireSchematic();
	const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	const allComponents = await eda.sch_PrimitiveComponent.getAll(undefined, false);
	const allPins = [];
	for (const component of allComponents) {
		if (!['part', 'netflag', 'netport'].includes(component.getState_ComponentType())) continue;
		const isMarker = ['netflag', 'netport'].includes(component.getState_ComponentType());
		const componentId = component.getState_PrimitiveId();
		const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
		if (!pins)
			throw new Error('GEOMETRY_UNAVAILABLE: 引脚列表不可用');
		for (const pin of pins) allPins.push({ componentId, pin, isMarker, netName: isMarker ? component.getState_Net() : undefined });
	}
	const wires = await readSchematicWires();
	const lines = wires.map(wire => wire.getState_Line());
	const plannedWireNets = new Map<number, string>();
	const labels = (await eda.sch_PrimitiveAttribute.getAll()).filter(label => label.getState_Key().toUpperCase() === 'NET');
	const netObjects = [...labels, ...allComponents.filter(component => ['netflag', 'netport'].includes(component.getState_ComponentType()))];
	const plan = [];
	for (const item of assignments) {
		const key = JSON.stringify([item.componentId, item.pinNumber]);
		if (keys.has(key))
			throw new Error('同一引脚不能重复配置');
		keys.add(key);
		const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(item.componentId);
		const matches = pins?.filter(pin => pin.getState_PinNumber() === item.pinNumber) ?? [];
		if (matches.length !== 1)
			throw new Error(`引脚不存在或不唯一: ${item.componentId}.${item.pinNumber}`);
		const pin = matches[0];
		if (pin.getState_NoConnected())
			throw new Error(`引脚具有未连接标记: ${item.componentId}.${item.pinNumber}`);
		const x = number(pin.getState_X(), Number.NaN);
		const y = number(pin.getState_Y(), Number.NaN);
		const touching = allPins.some(other => !(other.isMarker && other.netName === item.netName) && (other.componentId !== item.componentId || other.pin.getState_PinNumber() !== item.pinNumber)
			&& Math.hypot(other.pin.getState_X() - x, other.pin.getState_Y() - y) < 1);
		if (touching)
			throw new Error(`PIN_COLLISION: ${item.componentId}.${item.pinNumber} 与其他引脚粘连`);
		const connected = connectedWires(x, y, lines);
		for (const index of connected) {
			const previous = plannedWireNets.get(index);
			if (previous && previous !== item.netName)
				throw new Error('NET_CONFLICT: 同一连通导线组不能配置不同网名');
			plannedWireNets.set(index, item.netName);
		}
		const onConnectedWire = (px: number, py: number): boolean => [...connected].some(index => pointOnWire(px, py, lines[index]));
		const existingNets = [
			...[...connected].map(index => wires[index].getState_Net()),
			...labels.filter(label => (label.getState_X() === x && label.getState_Y() === y)
				|| (label.getState_X() !== null && label.getState_Y() !== null && onConnectedWire(label.getState_X()!, label.getState_Y()!))).map(label => label.getState_Value()),
			...allPins.filter(other => other.isMarker && ((other.pin.getState_X() === x && other.pin.getState_Y() === y)
				|| onConnectedWire(other.pin.getState_X(), other.pin.getState_Y()))).map(other => other.netName ?? ''),
		].filter(Boolean);
		if (existingNets.some(net => net !== item.netName))
			throw new Error(`NET_CONFLICT: 引脚已连接 ${existingNets.join(', ')}，拒绝意外合并/重命名`);
		const line = netLead(x, y, number(stateValue(pin, 'getState_Rotation', 'rotation'), 0), leadLength);
		plan.push({ ...item, x, y, rotation: number(stateValue(pin, 'getState_Rotation', 'rotation'), 0), line, alreadyConnected: connected.size > 0 && existingNets.includes(item.netName) });
	}
	if (routing === 'staircase') {
		if (assignments.some(item => item.terminal !== 'none')) throw new Error('staircase 当前仅支持 terminal=none；末端符号请单独规划');
		for (const componentId of new Set(plan.map(p => p.componentId))) {
			const group = plan.filter(p => p.componentId === componentId && !p.alreadyConnected);
			const reservedLead = netLabelPlacement === 'outer' ? Math.max(leadLength, ...group.map(p => Math.ceil(([...p.netName].length * 10 + 12) / 10) * 10)) : leadLength;
			const routes = staircaseLeads(group, reservedLead, lanePitch);
			group.forEach((p, i) => { p.line = routes[i]; });
		}
	}
	// Fan out optional symbols onto a wider lane, rather than pin-pitch placement.
	const symbolGroups = new Map<string, typeof plan>();
	for (const item of plan.filter(item => item.terminal !== 'none' && !item.alreadyConnected)) {
		const key = `${item.componentId}:${Math.sign(item.line[2] - item.x)},${Math.sign(item.line[3] - item.y)}`;
		const group = symbolGroups.get(key) ?? [];
		group.push(item); symbolGroups.set(key, group);
	}
	for (const group of symbolGroups.values()) {
		const horizontal = group[0].line[2] !== group[0].x;
		group.sort((a, b) => horizontal ? a.y - b.y : a.x - b.x);
		const middle = group.reduce((sum, item) => sum + (horizontal ? item.y : item.x), 0) / group.length;
		for (const [index, item] of group.entries()) {
			const offset = middle + (index - (group.length - 1) / 2) * 60;
			const dx = Math.sign(item.line[2] - item.x), dy = Math.sign(item.line[3] - item.y);
			const length = leadLength + Math.abs(offset - (horizontal ? item.y : item.x));
			item.line = [item.x, item.y, item.x + dx * 20, item.y + dy * 20,
				horizontal ? item.x + dx * 20 : offset, horizontal ? offset : item.y + dy * 20,
				horizontal ? item.x + dx * length : offset, horizontal ? offset : item.y + dy * length];
		}
	}
	// A route can cross a symbol or its text without touching any pin or wire.
	// Check the whole batch before writing, including terminal="none" leads.
	const partBounds = [];
	if (plan.some(item => !item.alreadyConnected)) {
		for (const component of allComponents.filter(component => component.getState_ComponentType() === 'part')) {
			const id = component.getState_PrimitiveId();
			partBounds.push({ id, box: (await readComponentGeometry(component, id)).box });
		}
	}
	for (const item of plan.filter(item => !item.alreadyConnected)) {
		for (const other of partBounds.filter(other => other.id !== item.componentId)) {
			if (wireSegments(item.line).some(segment => obstacleOverlaps(other.box, { id: other.id, box: other.box, segment: segment as [number, number, number, number] }, 2)))
				throw new Error(`LAYOUT_COLLISION: ${item.componentId}.${item.pinNumber} 引线穿过器件/属性 ${other.id}；请先调整布局或缩短 leadLength，不要拆成单引脚重试绕过检查`);
		}
		if (allPins.some(other => !(other.isMarker && other.netName === item.netName) && (other.componentId !== item.componentId || other.pin.getState_PinNumber() !== item.pinNumber)
			&& pointOnWire(other.pin.getState_X(), other.pin.getState_Y(), item.line))) throw new Error('PIN_COLLISION: 引线路径经过其他引脚');
		if (wires.some(wire => wire.getState_Net() !== item.netName && wiresTouch(item.line, wire.getState_Line()))) throw new Error('NET_CONFLICT: 引线路径与其他网络交叉');
		if (allComponents.some(component => component.getState_Net() && component.getState_Net() !== item.netName && pointOnWire(component.getState_X(), component.getState_Y(), item.line))) throw new Error('NET_CONFLICT: 引线路径经过其他网络标识');
		if (plan.some(other => other !== item && !other.alreadyConnected && other.netName !== item.netName && wiresTouch(item.line, other.line))) throw new Error('NET_CONFLICT: 规划引线相交');
	}
	const labelTargets = new Map<string, Box>();
	if (netLabelPlacement === 'outer') {
		const obstacles: Obstacle[] = partBounds.map(p => ({ ...p }));
		// Dry-run provides conservative model regions, not a claim of measured text.
		if (!dryRun) obstacles.push(...(await readNativeAttributes(page!.uuid)).map(a => ({ id: a.id, box: a.box })));
		if (wires.length) obstacles.push(...await readNativeWireObstacles(page!.uuid));
		for (const line of plan.map(p => p.line)) for (const segment of wireSegments(line)) {
			const [ax, ay, bx, by] = segment;
			obstacles.push({ id: 'wire', box: { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minY: Math.min(ay, by), maxY: Math.max(ay, by) }, segment: segment as [number, number, number, number] });
		}
		for (const item of plan.filter(p => !p.alreadyConnected)) {
			const target = chooseOuterLabelBox(item.line, [...item.netName].length * 10, obstacles);
			labelTargets.set(`${item.componentId}.${item.pinNumber}`, target);
			obstacles.push({ id: `label:${item.componentId}.${item.pinNumber}`, box: target });
		}
	}
	if (dryRun)
		return { ok: true, dryRun, plan, routing, netLabelPlacement, labelRegions: Object.fromEntries(labelTargets), textGeometryVerified: false };
	const results: Record<string, unknown>[] = [];
	for (const item of plan) {
		let createdNetId: string | undefined;
		let createdWireId: string | undefined;
		try {
			assertExecutionDeadline();
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid)
				throw new Error('DOCUMENT_CHANGED');
			if (item.alreadyConnected) {
				results.push({ ...item, ok: true, executionState: 'already_connected' });
				continue;
			}
			// Reserve a conservative text area before invoking the non-atomic label API.
			const endX = item.line[item.line.length - 2], endY = item.line[item.line.length - 1];
			const reservedBox = { minX: endX - 20, minY: endY - 20, maxX: endX + 20 + item.netName.length * 12, maxY: endY + 20 };
			for (const existing of item.terminal === 'none' ? [] : netObjects) {
				if (overlaps(reservedBox, await reliableOrConservativeBox(existing, existing.getState_PrimitiveId()), 2)) {
					throw new Error('LABEL_COLLISION: 标签预留文字区域重叠，请调整布局');
				}
			}
			assertExecutionDeadline();
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid)
				throw new Error('DOCUMENT_CHANGED');
			const wire = await eda.sch_PrimitiveWire.create(item.line, item.netName, null, null, null);
			if (!wire) throw new Error('NET 导线创建返回空结果；请使用 Escape Hatch，不要重试包装器');
			// Wire.create has the same cross-version return variants as component
			// creation.  Reading through stateValue avoids "getState_* is not a
			// function" failures while retaining the existing persistence checks.
			const primitiveIdValue = stateValue(wire, 'getState_PrimitiveId', 'primitiveId');
			if (typeof primitiveIdValue !== 'string' || !primitiveIdValue)
				throw new Error('NET 导线创建结果缺少图元 ID；请使用 Escape Hatch，不要重试包装器');
			const primitiveId = primitiveIdValue;
			createdWireId = primitiveId;
			if (item.terminal !== 'none') {
				assertExecutionDeadline();
				if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid) throw new Error('DOCUMENT_CHANGED');
				const label = item.terminal === 'port'
					? await eda.sch_PrimitiveComponent.createNetPort('BI', item.netName, endX, endY, 0, false)
					: await eda.sch_PrimitiveComponent.createNetFlag(item.terminal === 'ground' ? 'Ground' : 'Power', item.netName, endX, endY, 0, false);
				if (!label) throw new Error('末端符号创建失败，已停止');
				createdNetId = label.getState_PrimitiveId();
				const terminalPins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(createdNetId);
				if (!terminalPins?.some(pin => pin.getState_X() === endX && pin.getState_Y() === endY)) throw new Error('末端符号实际引脚未接到引线端点，请使用 Escape Hatch 核对原生符号几何');
				const box = await reliableOrConservativeBox(label, createdNetId);
				const boundary = [box.minX, box.minY, box.maxX, box.minY, box.maxX, box.maxY, box.minX, box.maxY, box.minX, box.minY];
				for (const other of plan) if (other !== item && !other.alreadyConnected && wiresTouch(boundary, other.line)) throw new Error('LABEL_COLLISION: 外移符号覆盖其他引线');
				for (const component of allComponents.filter(component => component.getState_ComponentType() === 'part')) {
					if (overlaps(box, await reliableOrConservativeBox(component, component.getState_PrimitiveId()), 2)) throw new Error('LABEL_COLLISION: 外移符号覆盖器件');
				}
				for (const existing of netObjects) if (overlaps(box, await reliableOrConservativeBox(existing, existing.getState_PrimitiveId()), 2)) throw new Error('LABEL_COLLISION: 外移符号仍有重叠');
				if (allPins.some(other => other.pin.getState_X() >= box.minX && other.pin.getState_X() <= box.maxX && other.pin.getState_Y() >= box.minY && other.pin.getState_Y() <= box.maxY)) throw new Error('PIN_COLLISION: 外移符号覆盖了引脚');
				netObjects.push(label);
			}
			const persisted = await eda.sch_PrimitiveWire.get(primitiveId);
			const confirmed = stateValue(persisted, 'getState_Net', 'net') === item.netName
				&& pointOnWire(item.x, item.y, stateValue(persisted, 'getState_Line', 'line'))
				&& pointOnWire(endX, endY, stateValue(persisted, 'getState_Line', 'line'));
			const endpointConfirmed = confirmed;
			results.push({ ...item, ok: endpointConfirmed, primitiveId, ...(createdNetId ? { terminalId: createdNetId } : {}), executionState: endpointConfirmed ? 'net_confirmed' : 'unconfirmed' });
			if (!endpointConfirmed)
				break;
		}
		catch (error) {
			let cleanedUp = false;
			try {
				if (createdNetId && (await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid === page?.uuid)
					cleanedUp = await eda.sch_PrimitiveComponent.delete(createdNetId);
				if (createdWireId && (await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid === page?.uuid)
					cleanedUp = await eda.sch_PrimitiveWire.delete(createdWireId) && (!createdNetId || cleanedUp);
			}
			catch { /* Preserve cleanup uncertainty in the result. */ }
			results.push({ ...item, ok: false, error: toSafeErrorMessage(error), createdNetId, createdWireId, cleanedUp });
			break;
		}
	}
	// A visible NET port is not proof that EDA incorporated it into the electrical netlist.
	let drcCheckPassed: boolean | undefined;
	try {
		if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid)
			throw new Error('DOCUMENT_CHANGED');
		if (results.some(item => item.ok)) {
			// The host may defer connectivity calculation after native writes.
			// Request a strict DRC refresh before exporting; still reject stale/empty nets.
			drcCheckPassed = await eda.sch_Drc.check(true, false, false) === true;
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid) throw new Error('DOCUMENT_CHANGED');
			const file = await eda.sch_ManufactureData.getNetlistFile();
			if (!file) throw new Error('网表不可用');
			const netlist: unknown = JSON.parse(await file.text());
			if (!isPlainObjectRecord(netlist) || !isPlainObjectRecord(netlist.components)) throw new Error('网表格式不可识别');
			for (const item of results) {
				if (!item.ok) continue;
				const component = allComponents.find(value => value.getState_PrimitiveId() === item.componentId);
				const uniqueId = String(stateValue(component, 'getState_UniqueId', 'uniqueId') || item.componentId);
				const entry = netlist.components[uniqueId];
				const pin = isPlainObjectRecord(entry) && isPlainObjectRecord(entry.pinInfoMap) ? entry.pinInfoMap[String(item.pinNumber)] : undefined;
				item.netlistConfirmed = isPlainObjectRecord(pin) && pin.net === item.netName;
				if (!isPlainObjectRecord(pin) || pin.net !== item.netName) {
					item.ok = false;
					item.executionState = 'unconfirmed';
					item.error = `网表未确认 ${item.componentId}.${item.pinNumber} → ${item.netName}；NET 对象可能已存在，请回读后处理，不要重复创建。`;
				}
			}
		}
	}
	catch (error) {
		for (const item of results) {
			if (!item.ok) continue;
			item.ok = false;
			item.executionState = 'unconfirmed';
			item.error = `无法验证实际连接：${toSafeErrorMessage(error)}；请回读，不要重复创建。`;
		}
	}
	let textGeometryVerified = false;
	let netLabelGeometry: unknown;
	if (netLabelPlacement === 'outer' && results.length === plan.length && results.every(r => r.ok)) {
		try {
			const routes: OuterLabelRoute[] = results.filter(r => !r.alreadyConnected).map(r => ({ primitiveId: String(r.primitiveId), netName: String(r.netName), line: r.line as number[], target: labelTargets.get(`${r.componentId}.${r.pinNumber}`)! }));
			netLabelGeometry = await placeOuterNetLabels(page!.uuid, routes, async () => {
				assertExecutionDeadline();
				if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page?.uuid) throw new Error('DOCUMENT_CHANGED');
			});
			textGeometryVerified = routes.length > 0 && routes.length === results.length;
		} catch (error) {
			for (const r of results.filter(r => !r.alreadyConnected)) { r.ok = false; r.executionState = 'label_unconfirmed'; r.error = `连接已回读，文字布局未确认：${toSafeErrorMessage(error)}；保留已知导线，禁止重复创建。`; }
		}
	}
	const failed = results.find(item => !item.ok);
	return { ok: results.length === plan.length && results.every(item => item.ok), results, total: plan.length, attempted: results.length,
		routing, netLabelPlacement, textGeometryVerified, netLabelGeometry, drcCheckPassed,
		connectionVerification: { requested: plan.length, confirmed: results.filter(r => r.netlistConfirmed === true).length, connectionsConfirmed: results.length === plan.length && results.every(r => r.netlistConfirmed === true) },
		remainingIndices: plan.flatMap((_, index) => results[index]?.ok ? [] : [index]),
		...(failed && failed.executionState !== 'label_unconfirmed' ? { escapeHatch: { tool: 'api_invoke', apiFullName: 'eda.sch_PrimitiveWire.create', args: [Array.isArray(failed.line) ? [...failed.line] : failed.line, failed.netName, null, null, null],
			message: '停止重试 pin_net_configure；先核对返回图元 ID 与当前网表，确认未创建后再按 api_search 签名直接调用。切页、短接或布局冲突不能绕过。' } } : {}),
		verification: '请调用 schematic_review 核对实际网表与 DRC；失败项先回读再续做，不要重放整批。' };
}
