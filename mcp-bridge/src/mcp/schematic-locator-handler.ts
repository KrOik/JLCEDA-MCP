import { isPlainObjectRecord, parseBoundedIntegerValue } from '../utils';
import {
	SCHEMATIC_LOCATOR_DEFAULT_LIMIT,
	SCHEMATIC_LOCATOR_DEFAULT_SCOPE,
	SCHEMATIC_LOCATOR_MAX_LIMIT,
	type SchematicLocatorComponentMatch,
	type SchematicLocatorMatch,
	type SchematicLocatorSuggestion,
	type SchematicLocatorRequest,
	type SchematicLocatorResponse,
	type SchematicLocatorScope,
} from '../../../shared/schematic-locator.ts';
import {
	collectSchematicSemanticSnapshot,
	collectSchematicSemanticSnapshotForCurrentPage,
	type SchematicSemanticSnapshot,
	type SchematicSemanticComponent,
} from './schematic-read-handler.ts';
import { safeCall } from '../utils';

function normalizeText(value: string): string {
	return value.trim().toLowerCase().replace(/[\s_\-\.]+/g, '');
}

function normalizeScope(value: unknown): SchematicLocatorScope {
	const scope = String(value ?? SCHEMATIC_LOCATOR_DEFAULT_SCOPE).trim();
	if (scope === 'current-page' || scope === 'current-schematic' || scope === 'all-schematics') {
		return scope;
	}
	throw new Error('schematic_locate scope 仅支持 current-page/current-schematic/all-schematics。');
}

function scoreTextMatch(query: string, value: string, baseScore: number): number {
	const normalizedValue = normalizeText(value);
	if (query.length === 0 || normalizedValue.length === 0) {
		return 0;
	}
	if (normalizedValue === query) {
		return baseScore;
	}
	if (normalizedValue.includes(query)) {
		return Math.max(1, baseScore - 20);
	}
	if (query.includes(normalizedValue)) {
		return Math.max(1, baseScore - 35);
	}
	return 0;
}

function componentFieldScores(query: string, component: SchematicSemanticComponent): Array<{ score: number; text: string }> {
	return [
		{ score: scoreTextMatch(query, component.componentDesignator, 100), text: component.componentDesignator },
		{ score: scoreTextMatch(query, component.componentSymbolName, 92), text: component.componentSymbolName },
		{ score: scoreTextMatch(query, component.footprintName, 86), text: component.footprintName },
		{ score: scoreTextMatch(query, component.uniqueId, 84), text: component.uniqueId },
		{ score: scoreTextMatch(query, component.manufacturerId, 82), text: component.manufacturerId },
		{ score: scoreTextMatch(query, component.manufacturer, 76), text: component.manufacturer },
		{ score: scoreTextMatch(query, component.supplierId, 74), text: component.supplierId },
		{ score: scoreTextMatch(query, component.supplier, 70), text: component.supplier },
		{ score: scoreTextMatch(query, component.schematicSubPartName, 64), text: component.schematicSubPartName },
	];
}

function mapComponent(component: SchematicSemanticComponent, pageContext: SchematicLocatorResponse['pageContext']): SchematicLocatorComponentMatch {
	return {
		componentInstanceId: component.componentInstanceId,
		designator: component.componentDesignator,
		symbolName: component.componentSymbolName,
		footprintName: component.footprintName,
		subPartName: component.schematicSubPartName,
		manufacturer: component.manufacturer,
		manufacturerId: component.manufacturerId,
		supplier: component.supplier,
		supplierId: component.supplierId,
		uniqueId: component.uniqueId,
		pageName: pageContext.pageName,
		pageUuid: pageContext.pageUuid,
		pageSchematicUuid: pageContext.schematicUuid,
		pins: component.pins.map(pin => ({
			pinNumber: pin.pinNumber,
			pinName: pin.pinSignalName,
			networkName: pin.connectedNetworkName,
			hasNoConnectMark: pin.hasNoConnectMark,
		})),
	};
}

function buildComponentMatch(query: string, component: SchematicSemanticComponent, pageContext: SchematicLocatorResponse['pageContext']): SchematicLocatorMatch | undefined {
	const best = componentFieldScores(query, component)
		.filter(item => item.score > 0)
		.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))[0];
	if (!best) {
		return undefined;
	}
	return {
		kind: 'component',
		score: best.score,
		matchText: best.text,
		component: mapComponent(component, pageContext),
	};
}

function buildNetMatch(query: string, networkName: string, connectedPins: string[]): SchematicLocatorMatch | undefined {
	const score = scoreTextMatch(query, networkName, 96);
	if (score <= 0) {
		return undefined;
	}
	return {
		kind: 'net',
		score,
		matchText: networkName,
		networkName,
		connectedPins: connectedPins.slice(0, 80),
	};
}

function sortMatches(a: SchematicLocatorMatch, b: SchematicLocatorMatch): number {
	return b.score - a.score
		|| (a.kind === b.kind ? 0 : a.kind === 'component' ? -1 : 1)
		|| a.matchText.localeCompare(b.matchText);
}

function isExactMatch(match: SchematicLocatorMatch, normalizedQuery: string): boolean {
	return normalizeText(match.matchText) === normalizedQuery;
}

function toSuggestion(match: SchematicLocatorMatch): SchematicLocatorSuggestion {
	return {
		...match,
		matchReason: 'fuzzy_candidate',
	};
}

function parseRequest(payload: unknown): Required<SchematicLocatorRequest> {
	if (!isPlainObjectRecord(payload)) {
		throw new TypeError('schematic_locate 任务参数必须为对象。');
	}
	const query = String(payload.query ?? '').trim();
	if (query.length === 0) {
		throw new Error('schematic_locate 缺少 query 参数。');
	}
	return {
		query,
		scope: normalizeScope(payload.scope),
		limit: parseBoundedIntegerValue(payload.limit, SCHEMATIC_LOCATOR_DEFAULT_LIMIT, 1, SCHEMATIC_LOCATOR_MAX_LIMIT),
	};
}

function normalizeRecordString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function buildSnapshotFromNetlistText(netlistText: string, pageContext: SchematicSemanticSnapshot['pageContext']): SchematicSemanticSnapshot {
	const parsed = JSON.parse(netlistText) as {
		components?: Record<string, {
			props?: Record<string, unknown>;
			pinInfoMap?: Record<string, { name?: unknown; number?: unknown; net?: unknown }>;
		}>;
	};

	const components: SchematicSemanticSnapshot['components'] = [];
	const networkToPinRefSetMap = new Map<string, Set<string>>();

	for (const [componentInstanceId, componentValue] of Object.entries(parsed.components ?? {})) {
		const props = componentValue?.props ?? {};
		const componentDesignator = normalizeRecordString(props.Designator);
		if (componentDesignator.length === 0) {
			continue;
		}

		const pins = Object.values(componentValue?.pinInfoMap ?? {}).map((pin) => {
			const pinNumber = normalizeRecordString(pin.number);
			const pinSignalName = normalizeRecordString(pin.name);
			const connectedNetworkName = normalizeRecordString(pin.net);

			if (connectedNetworkName.length > 0) {
				const pinRef = `${componentDesignator}.${pinNumber || pinSignalName}`;
				let networkPinSet = networkToPinRefSetMap.get(connectedNetworkName);
				if (!networkPinSet) {
					networkPinSet = new Set();
					networkToPinRefSetMap.set(connectedNetworkName, networkPinSet);
				}
				networkPinSet.add(pinRef);
			}

			return {
				pinNumber,
				pinSignalName,
				pinElectricalType: '',
				connectedNetworkName,
				hasNoConnectMark: false,
			};
		});

		components.push({
			componentInstanceId,
			componentDesignator,
			componentSymbolName: normalizeRecordString(props.Name),
			schematicSubPartName: normalizeRecordString(props.Name),
			footprintName: normalizeRecordString(props.FootprintName),
			manufacturer: normalizeRecordString(props.Manufacturer),
			manufacturerId: normalizeRecordString(props['Manufacturer Part']),
			supplier: normalizeRecordString(props.Supplier),
			supplierId: normalizeRecordString(props['Supplier Part']),
			uniqueId: normalizeRecordString(props['Unique ID']),
			pins,
		});
	}

	const networks = Array.from(networkToPinRefSetMap.entries())
		.map(([networkName, pinRefSet]) => ({
			networkName,
			connectedPinRefs: Array.from(pinRefSet).sort(),
		}))
		.sort((a, b) => a.networkName.localeCompare(b.networkName));

	return {
		pageContext,
		drcCheckPassed: true,
		components,
		networks,
	};
}

function buildComponentIdentityKey(component: SchematicSemanticSnapshot['components'][number]): string {
	const normalizedDesignator = normalizeText(component.componentDesignator);
	const normalizedManufacturerId = normalizeText(component.manufacturerId);
	const normalizedSupplierId = normalizeText(component.supplierId);
	const normalizedUniqueId = normalizeText(component.uniqueId);
	const normalizedFootprintName = normalizeText(component.footprintName);

	if (normalizedUniqueId.length > 0) {
		return `uid:${normalizedUniqueId}`;
	}
	if (normalizedDesignator.length > 0 && normalizedManufacturerId.length > 0) {
		return `designator+mpn:${normalizedDesignator}|${normalizedManufacturerId}`;
	}
	if (normalizedDesignator.length > 0 && normalizedSupplierId.length > 0) {
		return `designator+supplier:${normalizedDesignator}|${normalizedSupplierId}`;
	}
	return `fallback:${normalizedDesignator}|${normalizedManufacturerId}|${normalizedSupplierId}|${normalizedFootprintName}`;
}

function mergeSnapshots(primary: SchematicSemanticSnapshot, secondary: SchematicSemanticSnapshot): SchematicSemanticSnapshot {
	const componentMap = new Map<string, SchematicSemanticSnapshot['components'][number]>();
	const componentIdentityMap = new Map<string, string>();
	for (const component of primary.components) {
		componentMap.set(component.componentInstanceId, component);
		componentIdentityMap.set(buildComponentIdentityKey(component), component.componentInstanceId);
	}
	for (const component of secondary.components) {
		const identityKey = buildComponentIdentityKey(component);
		if (!componentMap.has(component.componentInstanceId) && !componentIdentityMap.has(identityKey)) {
			componentMap.set(component.componentInstanceId, component);
			componentIdentityMap.set(identityKey, component.componentInstanceId);
		}
	}

	const networkMap = new Map<string, Set<string>>();
	for (const network of [...primary.networks, ...secondary.networks]) {
		let pinSet = networkMap.get(network.networkName);
		if (!pinSet) {
			pinSet = new Set<string>();
			networkMap.set(network.networkName, pinSet);
		}
		for (const pinRef of network.connectedPinRefs) {
			pinSet.add(pinRef);
		}
	}

	return {
		pageContext: primary.pageContext,
		drcCheckPassed: primary.drcCheckPassed && secondary.drcCheckPassed,
		components: Array.from(componentMap.values()),
		networks: Array.from(networkMap.entries())
			.map(([networkName, pinSet]) => ({
				networkName,
				connectedPinRefs: Array.from(pinSet).sort(),
			}))
			.sort((a, b) => a.networkName.localeCompare(b.networkName)),
	};
}

async function collectScopedSnapshot(scope: SchematicLocatorScope): Promise<{ ok: true; snapshot: SchematicSemanticSnapshot } | { ok: false; error: string }> {
	if (scope === 'current-page') {
		return await collectSchematicSemanticSnapshotForCurrentPage();
	}

	const result = await collectSchematicSemanticSnapshot();
	if (!result.ok) {
		return result;
	}

	if (scope !== 'all-schematics') {
		return result;
	}

	const allPagesInfo = await eda.dmt_Schematic.getAllSchematicPagesInfo();
	const allPageNames = Array.isArray(allPagesInfo)
		? allPagesInfo
			.map((page: unknown) => {
				if (page && typeof page === 'object') {
					const record = page as Record<string, unknown>;
					const value = record.name ?? record.Name;
					return typeof value === 'string' ? value : '';
				}
				return '';
			})
			.filter((pageName: string) => pageName.length > 0)
		: [];

	const netlistFile = await safeCall<unknown>(() => Promise.resolve(eda.sch_ManufactureData.getNetlistFile()));
	const netlistFileObj = netlistFile as { text?: () => Promise<string> };
	const netlistText = typeof netlistFileObj?.text === 'function' ? await netlistFileObj.text() : '';
	if (typeof netlistText === 'string' && netlistText.trim().length > 0) {
		const netlistSnapshot = buildSnapshotFromNetlistText(netlistText, {
			...result.snapshot.pageContext,
			allPageNames,
		});
		return {
			ok: true,
			snapshot: mergeSnapshots({
				...result.snapshot,
				pageContext: {
					...result.snapshot.pageContext,
					allPageNames,
				},
			}, netlistSnapshot),
		};
	}

	return {
		ok: true,
		snapshot: {
			...result.snapshot,
			pageContext: {
				...result.snapshot.pageContext,
				allPageNames,
			},
		},
	};
}

export async function handleSchematicLocateTask(payload: unknown): Promise<unknown> {
	const request = parseRequest(payload);
	const result = await collectScopedSnapshot(request.scope);
	if (!result.ok) {
		return { ok: false, error: result.error };
	}

	const normalizedQuery = normalizeText(request.query);
	const pageContext = result.snapshot.pageContext;
	const componentMatches = result.snapshot.components
		.map(component => buildComponentMatch(normalizedQuery, component, pageContext))
		.filter((match): match is SchematicLocatorMatch => Boolean(match));
	const netMatches = result.snapshot.networks
		.map(network => buildNetMatch(normalizedQuery, network.networkName, network.connectedPinRefs))
		.filter((match): match is SchematicLocatorMatch => Boolean(match));
	const rankedMatches = [...componentMatches, ...netMatches].sort(sortMatches);
	const exactMatches = rankedMatches.filter(match => isExactMatch(match, normalizedQuery));
	const suggestions = rankedMatches
		.filter(match => !isExactMatch(match, normalizedQuery))
		.slice(0, request.limit)
		.map(toSuggestion);
	const matches = exactMatches.slice(0, request.limit);
	const exactMatchCount = exactMatches.length;
	const matchStatus = exactMatchCount > 0
		? exactMatchCount === 1 ? 'exact_match' : 'ambiguous'
		: 'no_exact_match';

	const response: SchematicLocatorResponse = {
		ok: true,
		query: request.query,
		normalizedQuery,
		scope: request.scope,
		limit: request.limit,
		matchStatus,
		matchPolicy: 'exact_then_suggest',
		totalCandidates: matches.length,
		pageContext,
		matches,
		suggestions,
		summary: {
			componentCount: result.snapshot.components.length,
			networkCount: result.snapshot.networks.length,
			exactMatchCount,
			suggestionCount: suggestions.length,
		},
	};
	return response;
}
