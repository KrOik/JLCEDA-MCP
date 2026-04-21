import type {
	PcbConstraintColor,
	PcbConstraintEnginePluginMetadata,
	PcbConstraintPadSnapshot,
	PcbConstraintSnapshotPayload,
	PcbConstraintSnapshotRequest,
	PcbConstraintSnapshotResponse,
	PcbConstraintViaSnapshot,
	PcbPadPairGroupSnapshot,
} from '../../../../shared/pcb-constraint-engine.ts';
import type { BridgePlugin } from '../plugin-contract.ts';
import {
	PCB_CONSTRAINT_ENGINE_PLUGIN_ID,
	PCB_CONSTRAINT_ENGINE_PLUGIN_VERSION,
} from '../../../../shared/pcb-constraint-engine.ts';

interface PrimitiveWithSyncState {
	toSync?: () => unknown;
}

function toSyncPrimitive<T>(primitive: T): T {
	if (primitive && typeof primitive === 'object' && typeof (primitive as PrimitiveWithSyncState).toSync === 'function') {
		return (primitive as PrimitiveWithSyncState).toSync!() as T;
	}
	return primitive;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedStringArray(values: unknown): string[] {
	if (!Array.isArray(values)) {
		return [];
	}
	return values
		.map(item => String(item ?? '').trim())
		.filter(item => item.length > 0);
}

function normalizeIncludeOptions(include: PcbConstraintSnapshotRequest['include'] | undefined): Required<NonNullable<PcbConstraintSnapshotRequest['include']>> {
	return {
		ruleConfiguration: include?.ruleConfiguration !== false,
		netRules: include?.netRules !== false,
		netByNetRules: include?.netByNetRules !== false,
		regionRules: include?.regionRules !== false,
		differentialPairs: include?.differentialPairs !== false,
		equalLengthNetGroups: include?.equalLengthNetGroups !== false,
		netClasses: include?.netClasses !== false,
		padPairGroups: include?.padPairGroups !== false,
		vias: include?.vias !== false,
		pads: include?.pads !== false,
	};
}

function normalizeRequest(payload: unknown): PcbConstraintSnapshotRequest {
	const input = isRecord(payload) ? payload : {};
	return {
		nets: asTrimmedStringArray(input.nets),
		viaPrimitiveIds: asTrimmedStringArray(input.viaPrimitiveIds),
		padPrimitiveIds: asTrimmedStringArray(input.padPrimitiveIds),
		include: normalizeIncludeOptions(input.include as PcbConstraintSnapshotRequest['include'] | undefined),
	};
}

function toFilterSet(values: string[] | undefined): Set<string> {
	return new Set((values ?? []).map(item => item.toUpperCase()));
}

function matchesNetFilter(net: string | null | undefined, filters: Set<string>): boolean {
	if (filters.size === 0) {
		return true;
	}
	return filters.has(String(net ?? '').trim().toUpperCase());
}

function toSerializableRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? { ...value } : {};
}

function toSerializableRecordArray(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		return value.filter(isRecord).map(item => ({ ...item }));
	}
	if (!isRecord(value)) {
		return [];
	}

	for (const key of ['items', 'data', 'list', 'rows', 'values']) {
		if (Array.isArray(value[key])) {
			return (value[key] as unknown[]).filter(isRecord).map(item => ({ ...item }));
		}
	}

	return Object.values(value)
		.filter(isRecord)
		.map(item => ({ ...item }));
}

function toColor(value: unknown): PcbConstraintColor | null {
	if (!isRecord(value)) {
		return null;
	}
	if (typeof value.r !== 'number' || typeof value.g !== 'number' || typeof value.b !== 'number' || typeof value.alpha !== 'number') {
		return null;
	}
	return {
		r: value.r,
		g: value.g,
		b: value.b,
		alpha: value.alpha,
	};
}

function getState<T>(primitive: unknown, method: string, fallback: T): T {
	try {
		const syncPrimitive = toSyncPrimitive(primitive as object) as Record<string, unknown>;
		const candidate = syncPrimitive?.[method];
		if (typeof candidate === 'function') {
			const result = (candidate as () => unknown).call(syncPrimitive);
			return result == null ? fallback : result as T;
		}
	}
	catch {
		// ignore state getter errors and fall back
	}
	return fallback;
}

async function callOptional<T>(warnings: string[], label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await fn();
	}
	catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		warnings.push(`${label} 读取失败：${message}`);
		return fallback;
	}
}

function normalizeDifferentialPairs(items: Record<string, unknown>[], netFilters: Set<string>): PcbConstraintSnapshotPayload['differentialPairs'] {
	return items
		.map(item => ({
			name: String(item.name ?? ''),
			positiveNet: String(item.positiveNet ?? ''),
			negativeNet: String(item.negativeNet ?? ''),
			raw: item,
		}))
		.filter(item => item.name.length > 0)
		.filter(item => netFilters.size === 0 || matchesNetFilter(item.positiveNet, netFilters) || matchesNetFilter(item.negativeNet, netFilters));
}

function normalizeNetGroups(items: Record<string, unknown>[], netFilters: Set<string>): PcbConstraintSnapshotPayload['equalLengthNetGroups'] {
	return items
		.map(item => ({
			name: String(item.name ?? ''),
			nets: asTrimmedStringArray(item.nets),
			color: toColor(item.color),
			raw: item,
		}))
		.filter(item => item.name.length > 0)
		.filter(item => netFilters.size === 0 || item.nets.some(net => matchesNetFilter(net, netFilters)));
}

function normalizeNetClasses(items: Record<string, unknown>[], netFilters: Set<string>): PcbConstraintSnapshotPayload['netClasses'] {
	return items
		.map(item => ({
			name: String(item.name ?? ''),
			nets: asTrimmedStringArray(item.nets),
			color: toColor(item.color),
			raw: item,
		}))
		.filter(item => item.name.length > 0)
		.filter(item => netFilters.size === 0 || item.nets.some(net => matchesNetFilter(net, netFilters)));
}

async function normalizePadPairGroups(
	items: Record<string, unknown>[],
	warnings: string[],
): Promise<PcbPadPairGroupSnapshot[]> {
	const output: PcbPadPairGroupSnapshot[] = [];
	for (const item of items) {
		const name = String(item.name ?? '');
		if (name.length === 0) {
			continue;
		}

		const padPairs = Array.isArray(item.padPairs)
			? (item.padPairs as unknown[])
					.filter(pair => Array.isArray(pair) && pair.length === 2)
					.map((pair) => {
						const tuple = pair as [unknown, unknown];
						return [String(tuple[0] ?? ''), String(tuple[1] ?? '')] as [string, string];
					})
			: [];
		const minWireLengthItems = await callOptional(
			warnings,
			`焊盘对组 ${name} 最短走线长度`,
			() => eda.pcb_Drc.getPadPairGroupMinWireLength(name),
			[] as unknown[],
		);
		output.push({
			name,
			padPairs,
			minWireLengths: Array.isArray(minWireLengthItems)
				? minWireLengthItems
						.filter(isRecord)
						.map((entry) => {
							const padPair = Array.isArray(entry.padPair) && entry.padPair.length === 2
								? [String(entry.padPair[0] ?? ''), String(entry.padPair[1] ?? '')] as [string, string]
								: ['', ''] as [string, string];
							return {
								padPair,
								minWireLength: Number(entry.minWireLength ?? 0),
							};
						})
						.filter(entry => entry.padPair[0].length > 0 && entry.padPair[1].length > 0)
				: [],
			raw: item,
		});
	}
	return output;
}

async function readViaSnapshots(
	warnings: string[],
	request: PcbConstraintSnapshotRequest,
	netFilters: Set<string>,
	rawViasInput?: unknown[],
): Promise<PcbConstraintViaSnapshot[]> {
	const viaIdFilters = new Set(request.viaPrimitiveIds ?? []);
	const rawVias = rawViasInput ?? [];
	const output: PcbConstraintViaSnapshot[] = [];

	for (const rawVia of Array.isArray(rawVias) ? rawVias : []) {
		const primitiveId = getState<string>(rawVia, 'getState_PrimitiveId', '');
		const net = getState<string>(rawVia, 'getState_Net', '');
		if ((viaIdFilters.size > 0 && !viaIdFilters.has(primitiveId)) || !matchesNetFilter(net, netFilters)) {
			continue;
		}

		const adjacentPrimitives = await callOptional(
			warnings,
			'via 邻接图元',
			() => (toSyncPrimitive(rawVia as object) as { getAdjacentPrimitives?: () => Promise<unknown[]> }).getAdjacentPrimitives?.() ?? Promise.resolve([]),
			[] as unknown[],
		);
		output.push({
			primitiveId,
			net,
			position: {
				x: Number(getState<number>(rawVia, 'getState_X', 0)),
				y: Number(getState<number>(rawVia, 'getState_Y', 0)),
			},
			diameter: Number(getState<number>(rawVia, 'getState_Diameter', 0)),
			holeDiameter: Number(getState<number>(rawVia, 'getState_HoleDiameter', 0)),
			viaType: String(getState<string>(rawVia, 'getState_ViaType', '')),
			blindViaRuleName: getState<string | null>(rawVia, 'getState_DesignRuleBlindViaName', null),
			solderMaskExpansion: getState<unknown>(rawVia, 'getState_SolderMaskExpansion', null),
			adjacentPrimitiveIds: (Array.isArray(adjacentPrimitives) ? adjacentPrimitives : [])
				.map(item => getState<string>(item, 'getState_PrimitiveId', ''))
				.filter(item => item.length > 0),
			primitiveLock: Boolean(getState<boolean>(rawVia, 'getState_PrimitiveLock', false)),
		});
	}

	return output;
}

async function readPadSnapshots(
	request: PcbConstraintSnapshotRequest,
	netFilters: Set<string>,
	rawPadsInput?: unknown[],
): Promise<PcbConstraintPadSnapshot[]> {
	const padIdFilters = new Set(request.padPrimitiveIds ?? []);
	const rawPads = rawPadsInput ?? [];
	const output: PcbConstraintPadSnapshot[] = [];

	for (const rawPad of Array.isArray(rawPads) ? rawPads : []) {
		const primitiveId = getState<string>(rawPad, 'getState_PrimitiveId', '');
		const net = getState<string | undefined>(rawPad, 'getState_Net', undefined) ?? null;
		if ((padIdFilters.size > 0 && !padIdFilters.has(primitiveId)) || !matchesNetFilter(net, netFilters)) {
			continue;
		}

		output.push({
			primitiveId,
			net,
			layerId: Number(getState<number>(rawPad, 'getState_Layer', 0)),
			position: {
				x: Number(getState<number>(rawPad, 'getState_X', 0)),
				y: Number(getState<number>(rawPad, 'getState_Y', 0)),
			},
			padNumber: String(getState<string>(rawPad, 'getState_PadNumber', '')),
			padType: String(getState<unknown>(rawPad, 'getState_PadType', '')),
			rotation: Number(getState<number>(rawPad, 'getState_Rotation', 0)),
			hole: getState<unknown>(rawPad, 'getState_Hole', null),
			holeOffsetX: Number(getState<number>(rawPad, 'getState_HoleOffsetX', 0)),
			holeOffsetY: Number(getState<number>(rawPad, 'getState_HoleOffsetY', 0)),
			holeRotation: Number(getState<number>(rawPad, 'getState_HoleRotation', 0)),
			metallization: Boolean(getState<boolean>(rawPad, 'getState_Metallization', false)),
			padShape: getState<unknown>(rawPad, 'getState_Pad', null),
			specialPadShape: getState<unknown>(rawPad, 'getState_SpecialPad', null),
			heatWelding: getState<unknown>(rawPad, 'getState_HeatWelding', null),
			solderMaskAndPasteMaskExpansion: getState<unknown>(rawPad, 'getState_SolderMaskAndPasteMaskExpansion', null),
			primitiveLock: Boolean(getState<boolean>(rawPad, 'getState_PrimitiveLock', false)),
		});
	}

	return output;
}

async function buildViaSnapshots(
	warnings: string[],
	request: PcbConstraintSnapshotRequest,
	netFilters: Set<string>,
): Promise<PcbConstraintViaSnapshot[]> {
	const rawVias = await callOptional(warnings, '过孔约束快照', () => eda.pcb_PrimitiveVia.getAll(), [] as unknown[]);
	return await readViaSnapshots(warnings, request, netFilters, rawVias);
}

async function buildPadSnapshots(
	warnings: string[],
	request: PcbConstraintSnapshotRequest,
	netFilters: Set<string>,
): Promise<PcbConstraintPadSnapshot[]> {
	const rawPads = await callOptional(warnings, '焊盘约束快照', () => eda.pcb_PrimitivePad.getAll(), [] as unknown[]);
	return await readPadSnapshots(request, netFilters, rawPads);
}

async function buildSnapshot(request: PcbConstraintSnapshotRequest): Promise<{ warnings: string[]; snapshot: PcbConstraintSnapshotPayload }> {
	const pcbInfo = await eda.dmt_Pcb.getCurrentPcbInfo();
	if (!pcbInfo) {
		throw new Error('当前未检测到活动 PCB 页面，无法读取 PCB 第二层约束快照。');
	}

	const warnings: string[] = [];
	const include = normalizeIncludeOptions(request.include);
	const netFilters = toFilterSet(request.nets);

	if (request.nets?.length && include.padPairGroups) {
		warnings.push('padPairGroups 当前不支持按 nets 精确过滤，返回全量焊盘对组。');
	}

	const currentRuleConfigurationName = include.ruleConfiguration
		? await callOptional(warnings, '当前规则配置名称', () => eda.pcb_Drc.getCurrentRuleConfigurationName(), undefined)
		: undefined;
	const ruleConfiguration = include.ruleConfiguration
		? await callOptional(warnings, '当前规则配置', () => eda.pcb_Drc.getCurrentRuleConfiguration(), undefined)
		: undefined;
	const netRules = include.netRules
		? toSerializableRecordArray(await callOptional(warnings, '网络规则', () => eda.pcb_Drc.getNetRules(), [] as unknown[]))
		: [];
	const netByNetRules = include.netByNetRules
		? toSerializableRecord(await callOptional(warnings, '网络-网络规则', () => eda.pcb_Drc.getNetByNetRules(), {}))
		: {};
	const regionRules = include.regionRules
		? toSerializableRecordArray(await callOptional(warnings, '区域规则', () => eda.pcb_Drc.getRegionRules(), [] as unknown[]))
		: [];
	const differentialPairs = include.differentialPairs
		? normalizeDifferentialPairs(
				toSerializableRecordArray(await callOptional(warnings, '差分对', () => eda.pcb_Drc.getAllDifferentialPairs(), [] as unknown[])),
				netFilters,
			)
		: [];
	const equalLengthNetGroups = include.equalLengthNetGroups
		? normalizeNetGroups(
				toSerializableRecordArray(await callOptional(warnings, '等长网络组', () => eda.pcb_Drc.getAllEqualLengthNetGroups(), [] as unknown[])),
				netFilters,
			)
		: [];
	const netClasses = include.netClasses
		? normalizeNetClasses(
				toSerializableRecordArray(await callOptional(warnings, '网络类', () => eda.pcb_Drc.getAllNetClasses(), [] as unknown[])),
				netFilters,
			)
		: [];
	const padPairGroups = include.padPairGroups
		? await normalizePadPairGroups(
				toSerializableRecordArray(await callOptional(warnings, '焊盘对组', () => eda.pcb_Drc.getAllPadPairGroups(), [] as unknown[])),
				warnings,
			)
		: [];
	const vias = include.vias ? await buildViaSnapshots(warnings, request, netFilters) : [];
	const pads = include.pads ? await buildPadSnapshots(warnings, request, netFilters) : [];

	return {
		warnings,
		snapshot: {
			pcbId: String((pcbInfo as { uuid?: string }).uuid ?? ''),
			pcbName: String((pcbInfo as { name?: string }).name ?? ''),
			parentProjectUuid: String((pcbInfo as { parentProjectUuid?: string }).parentProjectUuid ?? ''),
			parentBoardName: String((pcbInfo as { parentBoardName?: string }).parentBoardName ?? ''),
			rules: {
				configurationName: typeof currentRuleConfigurationName === 'string' ? currentRuleConfigurationName : null,
				ruleConfiguration: isRecord(ruleConfiguration) ? { ...ruleConfiguration } : null,
				netRules,
				netByNetRules: Object.keys(netByNetRules).length > 0 ? netByNetRules : null,
				regionRules,
			},
			differentialPairs,
			equalLengthNetGroups,
			netClasses,
			padPairGroups,
			vias,
			pads,
			summary: {
				ruleConfigurationLoaded: isRecord(ruleConfiguration),
				netRuleCount: netRules.length,
				netByNetRuleCount: Object.keys(netByNetRules).length,
				regionRuleCount: regionRules.length,
				differentialPairCount: differentialPairs.length,
				equalLengthNetGroupCount: equalLengthNetGroups.length,
				netClassCount: netClasses.length,
				padPairGroupCount: padPairGroups.length,
				viaCount: vias.length,
				padCount: pads.length,
			},
		},
	};
}

class PcbConstraintEnginePlugin implements BridgePlugin {
	public readonly metadata: PcbConstraintEnginePluginMetadata = {
		id: PCB_CONSTRAINT_ENGINE_PLUGIN_ID,
		version: PCB_CONSTRAINT_ENGINE_PLUGIN_VERSION,
		displayName: 'PCB Constraint Context Engine',
	};

	public async execute(action: string, payload: unknown): Promise<unknown> {
		switch (action) {
			case 'snapshot':
				return await this.handleSnapshot(payload);
			default:
				throw new Error(`插件 ${this.metadata.id} 不支持 action=${action}。`);
		}
	}

	private async handleSnapshot(payload: unknown): Promise<PcbConstraintSnapshotResponse> {
		const request = normalizeRequest(payload);
		const { warnings, snapshot } = await buildSnapshot(request);
		return {
			ok: true,
			plugin: this.metadata,
			generatedAt: new Date().toISOString(),
			warnings,
			snapshot,
		};
	}
}

export const pcbConstraintEnginePlugin = new PcbConstraintEnginePlugin();
