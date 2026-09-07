import type { LayoutOptions, LayoutPart } from './schematic-layout';
import { readComponentGeometry, readObstacles } from './layout-safety';
import { planSchematicLayout } from './schematic-layout';
import { readSchematicWires } from './schematic-wire-reader';
import { isPlainObjectRecord, toSafeErrorMessage } from '../utils';
import { assertExecutionDeadline } from '../runtime/execution-guard';

function finite(value: unknown, fallback: number): number {
	const result = value === undefined ? fallback : value;
	if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('布局参数必须为有限数字');
	return result;
}

function state(value: any, field: string): unknown {
	if (Array.isArray(value) && value.length === 1) value = value[0];
	const getter = `getState_${field[0].toUpperCase()}${field.slice(1)}`;
	return typeof value?.[getter] === 'function' ? value[getter]() : value?.[field];
}

export interface RelayoutRequest {
	apply: boolean;
	componentIds?: string[];
	options: LayoutOptions;
}

/** Parse separately so the safe default and bounds stay unit-testable. */
export function parseRelayoutRequest(payload: unknown): RelayoutRequest {
	if (!isPlainObjectRecord(payload)) throw new Error('schematic_relayout 参数必须为对象');
	const layout = payload.layout === undefined ? {} : payload.layout;
	if (!isPlainObjectRecord(layout)) throw new Error('layout 必须为对象');
	if (payload.apply !== undefined && typeof payload.apply !== 'boolean') throw new Error('apply 必须为 boolean');
	const mode = layout.mode === undefined ? 'compact' : layout.mode;
	if (mode !== 'compact' && mode !== 'elk') throw new Error('已有原理图重排仅支持 compact/elk；精确坐标请使用 component_place 的 grid');
	const componentIds = payload.componentIds === undefined ? undefined : payload.componentIds;
	if (componentIds !== undefined && (!Array.isArray(componentIds) || componentIds.length < 1 || componentIds.length > 50 || componentIds.some(id => typeof id !== 'string' || !id.trim())))
		throw new Error('componentIds 必须为 1-50 个非空图元 ID');
	const options: LayoutOptions = {
		mode,
		startX: finite(layout.startX, 0),
		startY: finite(layout.startY, 0),
		grid: finite(layout.grid, 10),
		gap: finite(payload.clearance, 20),
		groupGap: finite(layout.groupGap, 60),
		padding: finite(layout.padding, 20),
		columns: finite(layout.columns, 4),
		maxRadius: finite(layout.maxRadius, 1000),
		weakNets: ['GND', 'VCC', 'VDD', 'VSS', '3V3', '+3V3', '5V', '+5V'],
	};
	if (layout.weakNets !== undefined) {
		if (!Array.isArray(layout.weakNets) || layout.weakNets.some(net => typeof net !== 'string' || !net.trim())) throw new Error('weakNets 必须为非空字符串数组');
		options.weakNets = layout.weakNets.map(net => net.trim());
	}
	if (options.grid <= 0 || options.gap < 10 || options.groupGap < options.gap || options.padding < 0 || !Number.isInteger(options.columns) || options.columns < 1 || options.columns > 50 || options.maxRadius < options.grid || options.maxRadius / options.grid > 200)
		throw new Error('布局约束非法：clearance>=10，groupGap>=clearance，grid>0，padding>=0，columns=1..50，maxRadius/grid=1..200');
	return { apply: payload.apply === true, componentIds: componentIds?.map(id => id.trim()), options };
}

/**
 * Re-layout is intentionally preview-first.  The current EDA Wire.modify API
 * corrupts its index on live pages, so any page containing wires is never
 * mutated.  This supplies a measured plan that a future wire-migration engine
 * can consume without pretending a visual move preserved connectivity.
 */
export async function handleSchematicRelayoutTask(payload: unknown): Promise<unknown> {
	const request = parseRelayoutRequest(payload);
	const page = await eda.dmt_Schematic.getCurrentSchematicPageInfo();
	if (!page) throw new Error('请先打开目标原理图页面');
	const allParts = await eda.sch_PrimitiveComponent.getAll('part' as never, false);
	const selected = request.componentIds
		? request.componentIds.map(id => allParts.find(part => String(state(part, 'primitiveId')) === id)).filter(Boolean) as typeof allParts
		: allParts;
	if (!selected.length) throw new Error('未找到可重排的物理器件');
	if (request.componentIds && selected.length !== request.componentIds.length) throw new Error('componentIds 包含当前页不存在的物理器件');
	const selectedIds = new Set(selected.map(part => String(state(part, 'primitiveId'))));
	const [wires, obstacles] = await Promise.all([readSchematicWires(), readObstacles(selectedIds)]);
	const parts: LayoutPart[] = [];
	for (const part of selected) {
		assertExecutionDeadline();
		const id = String(state(part, 'primitiveId'));
		const x = state(part, 'x'); const y = state(part, 'y');
		if (typeof x !== 'number' || typeof y !== 'number') throw new Error(`GEOMETRY_UNAVAILABLE: ${id} 缺少锚点坐标`);
		const geometry = await readComponentGeometry(part, id);
		parts.push({
			id,
			group: 'existing',
			box: { minX: geometry.box.minX - x, maxX: geometry.box.maxX - x, minY: geometry.box.minY - y, maxY: geometry.box.maxY - y },
			ports: geometry.ports.map(port => ({ ...port, x: port.x - x, y: port.y - y })),
			nets: {},
		});
	}
	const plan = await planSchematicLayout(parts, obstacles, request.options);
	const response = {
		mode: request.options.mode,
		componentCount: selected.length,
		wireCount: wires.length,
		positions: plan.positions,
		groups: plan.groups,
		requiresWireMigration: wires.length > 0,
		message: wires.length
			? '仅生成真实尺寸布局预览：当前页有导线，禁止移动器件，避免 Wire.modify 损坏导线索引或丢失电气连接。'
			: '预览通过；无导线页面可显式 apply=true 执行，并逐个回读确认位置。',
	};
	if (!request.apply) return { ok: true, dryRun: true, ...response };
	if (wires.length) return { ok: false, error: 'RELAYOUT_REQUIRES_WIRE_MIGRATION: 当前页存在导线；已拒绝写入。请保存预览并等待安全导线迁移能力，不要使用 api_invoke/Wire.modify 绕过。', ...response };
	const results: Array<Record<string, unknown>> = [];
	for (const position of plan.positions) {
		try {
			assertExecutionDeadline();
			if ((await eda.dmt_Schematic.getCurrentSchematicPageInfo())?.uuid !== page.uuid) throw new Error('DOCUMENT_CHANGED');
			if (!await eda.sch_PrimitiveComponent.modify(position.id, { x: position.x, y: position.y })) throw new Error('移动器件失败');
			const persisted = await eda.sch_PrimitiveComponent.get(position.id);
			const confirmed = state(persisted, 'x') === position.x && state(persisted, 'y') === position.y;
			results.push({ ...position, ok: confirmed, executionState: confirmed ? 'confirmed' : 'unconfirmed' });
			if (!confirmed) break;
		}
		catch (error) { results.push({ ...position, ok: false, error: toSafeErrorMessage(error) }); break; }
	}
	return { ok: results.length === plan.positions.length && results.every(result => result.ok), ...response, results, remainingIds: plan.positions.filter(position => !results.some(result => result.id === position.id && result.ok)).map(position => position.id) };
}
