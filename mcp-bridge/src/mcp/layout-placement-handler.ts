import type { LayoutOptions, LayoutPart } from './schematic-layout';
import { assertExecutionDeadline } from '../runtime/execution-guard';
import { isPlainObjectRecord, toSafeErrorMessage } from '../utils';
import { obstacleOverlaps, readComponentGeometry, readObstacles, translateBox, unionBoxes, validBox } from './layout-safety';
import { netLead } from './net-lead';
import { planSchematicLayout } from './schematic-layout';
import { reserveDesignators } from './designator-plan';

function finite(value: unknown, fallback: number): number {
	const n = value === undefined ? fallback : value;
	if (typeof n !== 'number' || !Number.isFinite(n))
		throw new Error('布局参数必须为有限数字');
	return n;
}
function nonempty(value: unknown): string {
	if (typeof value !== 'string' || !value.trim())
		throw new Error('uuid/libraryUuid/group/net/pinNumber 必须为非空字符串');
	return value.trim();
}
function state(value: any, field: string): unknown {
	if (Array.isArray(value) && value.length === 1)
		value = value[0];
	const getter = `getState_${field[0].toUpperCase()}${field.slice(1)}`;
	return typeof value?.[getter] === 'function' ? value[getter]() : value?.[field];
}

export async function handleLayoutPlacement(payload: Record<string, unknown>, connect: (args: unknown) => Promise<unknown>) {
	if (payload.layout !== undefined && !isPlainObjectRecord(payload.layout))
		throw new Error('layout 必须为对象');
	const layout = (payload.layout ?? {}) as Record<string, unknown>;
	const leadLength = finite(layout.leadLength, 40);
	if (leadLength < 30 || leadLength > 1000)
		throw new Error('leadLength 必须为 30..1000 个 EDA 原生单位');
	if (payload.dryRun !== undefined && typeof payload.dryRun !== 'boolean')
		throw new Error('dryRun 必须为 boolean');
	const options: LayoutOptions = {
		mode: layout.mode === undefined ? 'compact' : layout.mode as LayoutOptions['mode'],
		startX: finite(layout.startX, 0),
		startY: finite(layout.startY, 0),
		grid: finite(layout.grid, 10),
		gap: finite(payload.clearance, 20),
		groupGap: finite(layout.groupGap, Math.max(60, finite(payload.clearance, 20))),
		padding: finite(layout.padding, 20),
		columns: finite(layout.columns, 4),
		maxRadius: finite(layout.maxRadius, 1000),
		weakNets: ['GND', 'VCC', 'VDD', 'VSS', '3V3', '+3V3', '5V', '+5V'],
	};
	if (!['compact', 'elk'].includes(options.mode) || options.grid <= 0 || options.gap < 10 || options.groupGap < options.gap || options.padding < 0 || !Number.isInteger(options.columns) || options.columns < 1 || options.columns > 50 || options.maxRadius < options.grid || options.maxRadius / options.grid > 200)
		throw new Error('布局约束非法：clearance>=10，groupGap>=clearance，grid>0，padding>=0，columns=1..50，maxRadius/grid=1..200');
	if (layout.weakNets !== undefined) {
		if (!Array.isArray(layout.weakNets))
			throw new Error('weakNets 必须为数组');
		options.weakNets = layout.weakNets.map(nonempty);
	}
	if (layout.spacingX !== undefined || layout.spacingY !== undefined)
		throw new Error('固定 spacingX/spacingY 请使用 layout.mode=grid');
	if (!Array.isArray(payload.components) || payload.components.length < 1 || payload.components.length > 50)
		throw new Error('components 数量必须为 1-50');
	const items = payload.components.map((value) => {
		if (!isPlainObjectRecord(value))
			throw new Error('component 必须为对象');
		if (value.x !== undefined || value.y !== undefined)
			throw new Error('精确 x/y 请使用 layout.mode=grid；compact/elk 以功能块整体布局');
		const rotation = finite(value.rotation, 0);
		if (![0, 90, 180, 270].includes(rotation))
			throw new Error('rotation 必须为 0/90/180/270');
		if (value.mirror !== undefined && typeof value.mirror !== 'boolean')
			throw new Error('mirror 必须为 boolean');
		if (value.nets !== undefined && !isPlainObjectRecord(value.nets))
			throw new Error('nets 必须为对象');
		const nets = Object.fromEntries(Object.entries(value.nets ?? {}).map(([pin, net]) => [nonempty(pin), nonempty(net)]));
		return { uuid: nonempty(value.uuid), designator: value.designator === undefined ? undefined : nonempty(value.designator), libraryUuid: nonempty(value.libraryUuid), group: value.group === undefined ? 'default' : nonempty(value.group), rotation, mirror: value.mirror === true, subPartName: value.subPartName === undefined ? undefined : nonempty(value.subPartName), nets };
	});
	if (items.reduce((n, item) => n + Object.keys(item.nets).length, 0) > 50)
		throw new Error('每次最多配置 50 个引脚');
	const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	if (!page)
		throw new Error('请先打开目标原理图页面');
	const check = async () => {
		assertExecutionDeadline();
		if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page.uuid)
			throw new Error('DOCUMENT_CHANGED');
	};
	const obstacles = await readObstacles();
	const reserved = reserveDesignators(items, (await eda.sch_PrimitiveComponent.getAll('part' as never, false)).map(p => String(state(p, 'designator') ?? '')));
	if (payload.dryRun)
		return { ok: true, dryRun: true, geometryVerified: false, options, components: items, message: '参数预览无写入；新器件实际尺寸须在执行时读取，尚未计算/验证最终布局。' };
	const staged: Array<{ id: string; index: number; designator: string; geometry: Awaited<ReturnType<typeof readComponentGeometry>>; moved: boolean }> = [];
	const createdIds = new Set<string>();
	const results: Record<string, unknown>[] = [];
	let plan: Awaited<ReturnType<typeof planSchematicLayout>> | undefined;
	let failure: string | undefined;
	const cleanup: Array<{ primitiveId: string; deleted: boolean }> = [];
	try {
		const existing = await eda.sch_PrimitiveComponent.getAll('part' as never, false);
		const used = new Set(existing.map(p => String(state(p, 'designator') ?? '').toUpperCase()));
		const parts: LayoutPart[] = [];
		let stagingX = Math.max(0, ...obstacles.map(o => o.box.maxX)) + 20000;
		const stagingY = Math.max(0, ...obstacles.map(o => o.box.maxY)) + 20000;
		for (const [index, item] of items.entries()) {
			await check();
			const created = await eda.sch_PrimitiveComponent.create({ uuid: item.uuid, libraryUuid: item.libraryUuid }, stagingX, stagingY, item.subPartName, item.rotation, item.mirror, true, true);
			if (!created)
				throw new Error('器件创建返回空结果');
			// Pro API releases differ here: create() may return a live primitive,
			// a plain state snapshot, or a one-element array.  Do not bind the
			// layout path to the live-object interface only.
			const idValue = state(created, 'primitiveId');
			if (typeof idValue !== 'string' || !idValue)
				throw new Error('器件创建结果缺少图元 ID');
			const id = idValue;
			createdIds.add(id);
			const prefix = String(state(created, 'designator') ?? 'U?').match(/^[A-Z]+/i)?.[0] ?? 'U';
			let suffix = 1;
			while (used.has(`${prefix}${suffix}`.toUpperCase()) || reserved.has(`${prefix}${suffix}`.toUpperCase())) suffix++;
			if (item.designator && used.has(item.designator.toUpperCase()))
				throw new Error(`DESIGNATOR_CONFLICT: ${item.designator} 已存在，请选择未使用的位号`);
			const designator = item.designator ?? `${prefix}${suffix}`;
			used.add(designator.toUpperCase());
			await check();
			if (!await eda.sch_PrimitiveComponent.modify(id, { designator, uniqueId: id }))
				throw new Error('器件编号失败');
			const refreshed = await eda.sch_PrimitiveComponent.get(id);
			const geometry = await readComponentGeometry(Array.isArray(refreshed) ? refreshed[0] : refreshed ?? created, id);
			if (!geometry.measured)
				throw new Error(`GEOMETRY_UNAVAILABLE: ${id} 无真实尺寸，compact/elk 不使用猜测尺寸；可检查 SDK 或使用保守 grid 模式`);
			for (const pinNumber of Object.keys(item.nets)) {
				if (geometry.ports.filter(p => p.pinNumber === pinNumber).length !== 1)
					throw new Error(`引脚不存在或不唯一: ${id}.${pinNumber}`);
			}
			staged.push({ id, index, designator, geometry, moved: false });
			// Reserve exactly the named leads that the connection handler will create.
			const leadBoxes = geometry.ports.filter(p => item.nets[p.pinNumber]).map((p) => {
				const [ax, ay, bx, by] = netLead(p.x, p.y, p.rotation, leadLength);
				return validBox({ minX: ax, minY: ay, maxX: bx, maxY: by });
			});
			parts.push({ id, group: item.group, nets: item.nets, box: translateBox(unionBoxes([geometry.box, ...leadBoxes]), -stagingX, -stagingY), ports: geometry.ports.map(p => ({ ...p, x: p.x - stagingX, y: p.y - stagingY })) });
			stagingX = Math.max(stagingX, geometry.box.maxX) + 20000;
		}
		await check();
		plan = await planSchematicLayout(parts, obstacles, options);
		await check();
		for (const entry of staged) {
			const position = plan.positions.find(p => p.id === entry.id)!;
			const part = parts.find(p => p.id === entry.id)!;
			const current = await readObstacles(new Set(staged.filter(s => !s.moved).map(s => s.id)));
			for (const other of staged.filter(s => s.moved && s.id !== entry.id)) {
				const p = plan.positions.find(p => p.id === other.id)!;
				current.push({ id: p.id, box: translateBox(parts.find(part => part.id === p.id)!.box, p.x, p.y) });
			}
			if (current.some(o => obstacleOverlaps(translateBox(part.box, position.x, position.y), o, options.gap)))
				throw new Error('LAYOUT_COLLISION: 布局后障碍变化');
			await check();
			// A failed/throwing write can have taken effect. Preserve this ID for readback.
			entry.moved = true;
			if (!await eda.sch_PrimitiveComponent.modify(entry.id, { x: position.x, y: position.y }))
				throw new Error(`移动器件失败: ${entry.id}`);
			const persisted = await eda.sch_PrimitiveComponent.get(entry.id);
			const confirmed = state(persisted, 'x') === position.x && state(persisted, 'y') === position.y && state(persisted, 'designator') === entry.designator && state(persisted, 'uniqueId') === entry.id;
			results.push({ index: entry.index, ...position, primitiveId: entry.id, designator: entry.designator, uniqueId: entry.id, ok: confirmed, executionState: confirmed ? 'confirmed' : 'unconfirmed', geometry: { source: entry.geometry.source, width: entry.geometry.box.maxX - entry.geometry.box.minX, height: entry.geometry.box.maxY - entry.geometry.box.minY, placementEnvelope: translateBox(part.box, position.x, position.y) } });
			if (!confirmed)
				throw new Error('器件位置回读未确认');
		}
	}
	catch (error) { failure = toSafeErrorMessage(error); }
	finally {
		for (const id of createdIds) {
			if (staged.some(s => s.id === id && s.moved))
				continue;
			let deleted = false;
			try {
				if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid === page.uuid)
					deleted = await eda.sch_PrimitiveComponent.delete(id);
			}
			catch { /* Expose every remaining temporary ID. */ }
			cleanup.push({ primitiveId: id, deleted });
		}
	}
	let connections: any;
	if (!failure) {
		const assignments = staged.flatMap(s => Object.entries(items[s.index].nets).map(([pinNumber, netName]) => ({ componentId: s.id, pinNumber, netName })));
		if (assignments.length) {
			try {
				await check();
				connections = await connect({ assignments, leadLength });
			}
			catch (error) { connections = { ok: false, error: toSafeErrorMessage(error), assignments }; }
		}
	}
	return { ok: !failure && connections?.ok !== false, mode: options.mode, results, groups: plan?.groups, ...(failure ? { error: failure } : {}), ...(connections ? { connections } : {}), cleanup, unconfirmedPrimitiveIds: staged.filter(s => s.moved && !results.some(r => r.primitiveId === s.id && r.ok)).map(s => s.id), total: items.length, attempted: createdIds.size, remainingIndices: items.flatMap((_, index) => results.some(r => r.index === index && r.ok) ? [] : [index]) };
}
