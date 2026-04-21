/**
 * ------------------------------------------------------------------------
 * 名称：（桥接离线 API 检索任务处理）
 * 说明：（在 EDA 侧读取扩展离线文档并执行关键词检索）
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：（2026-03-13）
 * 备注：（仅处理 api/search 任务）
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord, parseBoundedIntegerValue, toSafeErrorMessage } from '../utils';

interface ApiProjectionItem {
	id: number;
	name: string;
	fullName: string;
	kind: string;
	ownerFullName: string;
	summary: string;
	signatureText?: string;
	typeText?: string;
	returnType?: string;
	parameters?: unknown[];
}

interface ApiDocument {
	queryIndexes?: {
		symbolIdByKeyword?: Record<string, number[]>;
	};
	projections?: {
		callableApis?: ApiProjectionItem[];
		types?: ApiProjectionItem[];
	};
}

interface ApiCache {
	allItems: ApiProjectionItem[];
	callableItems: ApiProjectionItem[];
	typeItems: ApiProjectionItem[];
	itemById: Map<number, ApiProjectionItem>;
	keywordIndex: Map<string, number[]>;
	searchTokensById: Map<number, SearchTokens>;
	rankingMetadataById: Map<number, ApiRankingMetadata>;
}

interface SearchTokens {
	normalizedName: string;
	normalizedFullName: string;
	normalizedOwnerFullName: string;
	normalizedSummary: string;
	nameTokens: string[];
	fullNameTokens: string[];
	ownerTokens: string[];
	summaryTokens: string[];
	mergedTokens: string[];
}

type ActionKind
	= | 'get'
		| 'set'
		| 'remove'
		| 'add'
		| 'start'
		| 'stop'
		| 'activate'
		| 'deactivate'
		| 'check'
		| 'copy'
		| 'update'
		| 'other';

type ContextKind
	= | 'generic'
		| 'schematic'
		| 'pcb'
		| 'event'
		| 'mouse'
		| 'split'
		| 'ratline'
		| 'rule';

interface ApiRankingMetadata {
	actionKind: ActionKind;
	familyKey: string;
	familyTokens: string[];
	isStateAccessor: boolean;
	isGenericStateAccessor: boolean;
	contextKind: ContextKind;
	domainHints: string[];
}

interface QueryMetadata {
	actionIntent: ActionKind | 'none';
	familyKey: string;
	familyTokens: string[];
	hasExplicitStateIntent: boolean;
	contextKind: ContextKind;
	domainHints: string[];
}

interface RankedSearchItem {
	id: number;
	name: string;
	fullName: string;
	kind: string;
	ownerFullName: string;
	summary: string;
	signatureText: string;
	typeText: string;
	returnType: string;
	parameters: unknown[];
	score: number;
	__familyTie: number;
	__actionTie: number;
	__genericStateTie: number;
}

interface EdaFileSystem {
	getExtensionFile: (uri: string) => Promise<File | undefined>;
}

const API_SEARCH_MAX_LIMIT = 50;
const API_DOCUMENT_URI = '/resources/jlceda-pro-api-doc.json';
const ACTION_STOP_TERMS = new Set([
	'get',
	'set',
	'is',
	'has',
	'can',
	'should',
	'delete',
	'remove',
	'add',
	'create',
	'start',
	'stop',
	'activate',
	'deactivate',
	'enable',
	'disable',
	'open',
	'close',
	'copy',
	'clone',
	'update',
	'refresh',
	'load',
	'save',
]);
const FAMILY_STOP_TERMS = new Set([
	'current',
	'already',
	'all',
	'the',
	'a',
	'an',
	'by',
	'for',
	'to',
	'from',
	'with',
	'on',
	'in',
	'of',
	'into',
	'out',
	'type',
]);
const TRAILING_STATE_TERMS = new Set(['state', 'status', 'info', 'tree', 'name', 'value', 'values']);
const QUERY_STATE_TERMS = new Set(['state', 'status', 'property', 'properties', 'attribute', 'attributes']);
const DOMAIN_HINT_TERMS = new Set([
	'schematic',
	'sch',
	'pcb',
	'event',
	'listener',
	'mouse',
	'split',
	'screen',
	'ratline',
	'rule',
	'configuration',
	'document',
	'page',
]);

let apiCache: ApiCache | null = null;

// 归一化检索文本，兼容 camelCase 与常见分隔符。
function normalizeSearchText(raw: string): string {
	return raw
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

// 获取 EDA 文件系统对象。
function getEdaFileSystem(): EdaFileSystem {
	const fileSystem = (eda as unknown as { sys_FileSystem?: unknown }).sys_FileSystem;
	if (!isPlainObjectRecord(fileSystem) || typeof fileSystem.getExtensionFile !== 'function') {
		throw new Error('当前环境缺少 eda.sys_FileSystem.getExtensionFile，无法读取离线 API 文档。');
	}

	return fileSystem as unknown as EdaFileSystem;
}

// 读取扩展内离线文档文本。
async function readApiDocumentText(): Promise<string> {
	const fileSystem = getEdaFileSystem();
	const extensionFile = await fileSystem.getExtensionFile(API_DOCUMENT_URI);
	if (!extensionFile) {
		throw new Error(`未找到离线 API 文档文件: ${API_DOCUMENT_URI}`);
	}

	return await extensionFile.text();
}

// 拆分检索关键词。
function splitTerms(raw: string): string[] {
	const normalized = normalizeSearchText(raw);
	if (normalized.length === 0) {
		return [];
	}

	return normalized.split(/\s+/).map(item => item.trim()).filter(item => item.length > 0);
}

// 构建关键词倒排索引。
function buildKeywordIndex(rawIndex: Record<string, number[]> | undefined): Map<string, number[]> {
	const output = new Map<string, number[]>();
	if (!rawIndex) {
		return output;
	}

	for (const [keyword, ids] of Object.entries(rawIndex)) {
		if (keyword.trim().length === 0 || !Array.isArray(ids)) {
			continue;
		}
		output.set(keyword.toLowerCase(), ids.filter(id => Number.isInteger(id)));
	}
	return output;
}

// 构建单个 API 的归一化检索元数据。
function buildSearchTokens(item: ApiProjectionItem): SearchTokens {
	const normalizedName = normalizeSearchText(String(item.name ?? ''));
	const normalizedFullName = normalizeSearchText(String(item.fullName ?? ''));
	const normalizedOwnerFullName = normalizeSearchText(String(item.ownerFullName ?? ''));
	const normalizedSummary = normalizeSearchText(String(item.summary ?? ''));
	const nameTokens = splitTerms(normalizedName);
	const fullNameTokens = splitTerms(normalizedFullName);
	const ownerTokens = splitTerms(normalizedOwnerFullName);
	const summaryTokens = splitTerms(normalizedSummary);

	return {
		normalizedName,
		normalizedFullName,
		normalizedOwnerFullName,
		normalizedSummary,
		nameTokens,
		fullNameTokens,
		ownerTokens,
		summaryTokens,
		mergedTokens: [...fullNameTokens, ...ownerTokens, ...summaryTokens],
	};
}

// 提取动作类型，供排序层使用。
function extractActionKind(tokens: string[]): ActionKind {
	const firstToken = tokens[0] ?? '';
	switch (firstToken) {
		case 'get':
		case 'fetch':
		case 'read':
		case 'query':
		case 'list':
			return 'get';
		case 'set':
		case 'assign':
			return 'set';
		case 'delete':
		case 'remove':
		case 'clear':
		case 'unregister':
			return 'remove';
		case 'add':
		case 'create':
		case 'insert':
		case 'register':
			return 'add';
		case 'start':
		case 'begin':
		case 'run':
			return 'start';
		case 'stop':
		case 'end':
			return 'stop';
		case 'activate':
		case 'open':
		case 'enable':
			return 'activate';
		case 'deactivate':
		case 'close':
		case 'disable':
			return 'deactivate';
		case 'is':
		case 'has':
		case 'can':
		case 'exist':
		case 'exists':
			return 'check';
		case 'copy':
		case 'clone':
			return 'copy';
		case 'update':
		case 'refresh':
		case 'rename':
		case 'move':
			return 'update';
		default:
			return 'other';
	}
}

// 将 owner token 归一到检索域名提示。
function normalizeDomainHint(token: string): string | null {
	if (token === 'sch') {
		return 'schematic';
	}
	if (token === 'listener') {
		return 'event';
	}
	if (token === 'screen') {
		return 'split';
	}
	return DOMAIN_HINT_TERMS.has(token) ? token : null;
}

// 提取 family tokens，弱化动作与泛化状态词干扰。
function extractFamilyTokens(tokens: string[]): string[] {
	if (tokens.length === 0) {
		return [];
	}

	let startIndex = 0;
	while (startIndex < tokens.length && (ACTION_STOP_TERMS.has(tokens[startIndex]) || FAMILY_STOP_TERMS.has(tokens[startIndex]))) {
		startIndex += 1;
	}

	const familyTokens = tokens.slice(startIndex).filter(token => !FAMILY_STOP_TERMS.has(token));
	let endIndex = familyTokens.length;
	while (endIndex > 1 && TRAILING_STATE_TERMS.has(familyTokens[endIndex - 1])) {
		endIndex -= 1;
	}
	return familyTokens.slice(0, endIndex);
}

// 根据 owner/method 构建域提示。
function buildDomainHints(ownerTokens: string[], familyTokens: string[]): string[] {
	const hints = new Set<string>();
	for (const token of [...ownerTokens, ...familyTokens]) {
		const normalized = normalizeDomainHint(token);
		if (normalized) {
			hints.add(normalized);
		}
	}
	return [...hints];
}

// 推断 context kind，仅作软偏置。
function resolveContextKind(domainHints: string[]): ContextKind {
	if (domainHints.includes('mouse')) {
		return 'mouse';
	}
	if (domainHints.includes('event')) {
		return 'event';
	}
	if (domainHints.includes('split')) {
		return 'split';
	}
	if (domainHints.includes('ratline')) {
		return 'ratline';
	}
	if (domainHints.includes('rule')) {
		return 'rule';
	}
	if (domainHints.includes('schematic')) {
		return 'schematic';
	}
	if (domainHints.includes('pcb')) {
		return 'pcb';
	}
	return 'generic';
}

// 构建 API 排序元数据。
function buildApiRankingMetadata(item: ApiProjectionItem, searchTokens: SearchTokens): ApiRankingMetadata {
	const methodTokens = searchTokens.nameTokens;
	const actionKind = extractActionKind(methodTokens);
	const familyTokens = extractFamilyTokens(methodTokens);
	const familyKey = familyTokens.join(' ');
	const methodName = String(item.name ?? '');
	const isGenericStateAccessor = /^(?:get|set|is)State_[\p{L}\p{N}]+$/u.test(methodName);
	const isStateAccessor = isGenericStateAccessor
		|| (actionKind === 'get' && methodTokens.some(token => token === 'state' || token === 'status'));
	const domainHints = buildDomainHints(searchTokens.ownerTokens, familyTokens);

	return {
		actionKind,
		familyKey,
		familyTokens,
		isStateAccessor,
		isGenericStateAccessor,
		contextKind: resolveContextKind(domainHints),
		domainHints,
	};
}

// 提取查询动作意图，优先显式动作词。
function extractQueryActionIntent(terms: string[]): ActionKind | 'none' {
	const termSet = new Set(terms);
	if (['remove', 'delete', 'clear', 'unregister'].some(term => termSet.has(term))) {
		return 'remove';
	}
	if (['add', 'create', 'insert', 'register'].some(term => termSet.has(term))) {
		return 'add';
	}
	if (['start', 'begin', 'run', 'calculate', 'calculating'].some(term => termSet.has(term))) {
		return 'start';
	}
	if (['stop', 'end'].some(term => termSet.has(term))) {
		return 'stop';
	}
	if (['activate', 'enable', 'open'].some(term => termSet.has(term))) {
		return 'activate';
	}
	if (['deactivate', 'disable', 'close'].some(term => termSet.has(term))) {
		return 'deactivate';
	}
	if (['set', 'update', 'change', 'rename'].some(term => termSet.has(term))) {
		return 'set';
	}
	if (['is', 'has', 'exist', 'exists', 'already'].some(term => termSet.has(term))) {
		return 'check';
	}
	if (['get', 'fetch', 'read', 'query', 'list'].some(term => termSet.has(term))) {
		return 'get';
	}
	return 'none';
}

// 构建 query 元数据。
function buildQueryMetadata(terms: string[]): QueryMetadata {
	const uniqueTerms = [...new Set(terms)];
	const actionIntent = extractQueryActionIntent(uniqueTerms);
	const hasExplicitStateIntent = uniqueTerms.some(term => QUERY_STATE_TERMS.has(term));
	const familyTokens = extractFamilyTokens(uniqueTerms.filter(term => !ACTION_STOP_TERMS.has(term)));
	const fallbackFamilyTokens = familyTokens.length > 0 ? familyTokens : uniqueTerms.filter(term => !FAMILY_STOP_TERMS.has(term));
	const domainHints = buildDomainHints([], fallbackFamilyTokens);

	return {
		actionIntent,
		familyKey: fallbackFamilyTokens.join(' '),
		familyTokens: fallbackFamilyTokens,
		hasExplicitStateIntent,
		contextKind: resolveContextKind(domainHints),
		domainHints,
	};
}

// 构建关键词索引 lookup terms，保留原词并补充紧凑查询短语。
function buildKeywordLookupTerms(terms: string[], normalizedQuery: string): string[] {
	const lookupTerms = new Set(terms);
	const compactQuery = normalizedQuery.replace(/\s+/g, '');
	if (compactQuery.length >= 6) {
		lookupTerms.add(compactQuery);
		lookupTerms.add(`get${compactQuery}`);
	}
	return [...lookupTerms];
}

// 统计两个 token 集合交集大小。
function countTokenIntersection(left: string[], right: string[]): number {
	if (left.length === 0 || right.length === 0) {
		return 0;
	}
	const leftSet = new Set(left);
	let count = 0;
	for (const token of new Set(right)) {
		if (leftSet.has(token)) {
			count += 1;
		}
	}
	return count;
}

// family 层奖励，保持温和惩罚。
function scoreFamilyAlignment(apiMeta: ApiRankingMetadata, queryMeta: QueryMetadata): { score: number; matchStrength: number } {
	const familyOverlap = countTokenIntersection(apiMeta.familyTokens, queryMeta.familyTokens);
	let score = familyOverlap * 3;
	const primaryQueryToken = queryMeta.familyTokens[0];
	if (primaryQueryToken) {
		if (apiMeta.familyTokens.includes(primaryQueryToken)) {
			score += 4;
		}
		else {
			score -= 5;
		}
	}
	if (apiMeta.familyKey.length > 0 && apiMeta.familyKey === queryMeta.familyKey) {
		score += 4;
	}
	if (queryMeta.familyTokens.length >= 2 && familyOverlap === 0) {
		score -= 2;
	}
	return { score: Math.max(-6, Math.min(14, score)), matchStrength: familyOverlap * 2 };
}

// 动作层奖励/惩罚，避免硬过滤。
function scoreActionAlignment(apiMeta: ApiRankingMetadata, queryMeta: QueryMetadata): { score: number; matchStrength: number } {
	const intent = queryMeta.actionIntent;
	if (intent === 'none') {
		if (apiMeta.actionKind === 'get' || apiMeta.actionKind === 'check') {
			return { score: 1, matchStrength: 1 };
		}
		if (apiMeta.actionKind === 'other' || apiMeta.actionKind === 'update') {
			return { score: 0, matchStrength: 0 };
		}
		return { score: -1, matchStrength: 0 };
	}

	if (apiMeta.actionKind === intent) {
		if (intent === 'remove') {
			return { score: 16, matchStrength: 4 };
		}
		return { score: 9, matchStrength: 3 };
	}

	if (intent === 'get') {
		return { score: apiMeta.actionKind === 'check' ? 3 : -2, matchStrength: 0 };
	}
	if (intent === 'check') {
		return { score: apiMeta.actionKind === 'get' ? 2 : -3, matchStrength: 0 };
	}
	if (intent === 'start') {
		if (apiMeta.actionKind === 'activate') {
			return { score: 2, matchStrength: 1 };
		}
		return { score: apiMeta.actionKind === 'get' || apiMeta.actionKind === 'check' ? -4 : -5, matchStrength: 0 };
	}
	if (intent === 'remove') {
		if (apiMeta.actionKind === 'deactivate') {
			return { score: 2, matchStrength: 1 };
		}
		return { score: apiMeta.actionKind === 'get' || apiMeta.actionKind === 'check' ? -9 : -4, matchStrength: 0 };
	}
	return { score: apiMeta.actionKind === 'get' || apiMeta.actionKind === 'check' ? -3 : -4, matchStrength: 0 };
}

// 泛化 state accessor 抑制，避免 getState_X 误报。
function scoreGenericStateSuppression(apiMeta: ApiRankingMetadata, queryMeta: QueryMetadata): number {
	if (!queryMeta.hasExplicitStateIntent && apiMeta.isGenericStateAccessor) {
		return -14;
	}
	return 0;
}

// 软 context 偏置。
function scoreContextBias(apiMeta: ApiRankingMetadata, queryMeta: QueryMetadata): number {
	if (queryMeta.contextKind === 'generic') {
		return 0;
	}
	if (apiMeta.contextKind === queryMeta.contextKind) {
		return 12;
	}
	if (apiMeta.domainHints.includes(queryMeta.contextKind)) {
		return 5;
	}
	return apiMeta.contextKind === 'generic' ? 0 : -6;
}

// 对候选集执行分层打分与稳定排序。
function rankCandidateItems(args: {
	candidateItems: ApiProjectionItem[];
	searchTokensById: Map<number, SearchTokens>;
	rankingMetadataById: Map<number, ApiRankingMetadata>;
	keywordScoreById: Map<number, number>;
	queryMetadata: QueryMetadata;
	normalizedQuery: string;
	queryLower: string;
	terms: string[];
	allowFallback: boolean;
}): RankedSearchItem[] {
	return args.candidateItems
		.map((item) => {
			const searchTokens = args.searchTokensById.get(item.id);
			const rankingMetadata = args.rankingMetadataById.get(item.id);
			if (!searchTokens || !rankingMetadata) {
				return null;
			}

			const keywordScore = args.keywordScoreById.get(item.id) ?? 0;
			const semanticScore = scoreSemanticMatch(searchTokens, args.normalizedQuery, args.terms);
			const fallbackScore = args.allowFallback && keywordScore === 0 && semanticScore === 0
				? scoreFallback(item, args.queryLower, args.terms)
				: 0;
			const familyLayer = scoreFamilyAlignment(rankingMetadata, args.queryMetadata);
			const actionLayer = scoreActionAlignment(rankingMetadata, args.queryMetadata);
			const genericStateSuppression = scoreGenericStateSuppression(rankingMetadata, args.queryMetadata);
			const contextBias = scoreContextBias(rankingMetadata, args.queryMetadata);
			const score = keywordScore
				+ semanticScore
				+ fallbackScore
				+ familyLayer.score
				+ actionLayer.score
				+ genericStateSuppression
				+ contextBias;
			if (score <= 0) {
				return null;
			}

			return {
				id: item.id,
				name: item.name,
				fullName: item.fullName,
				kind: item.kind,
				ownerFullName: item.ownerFullName,
				summary: item.summary,
				signatureText: item.signatureText ?? '',
				typeText: item.typeText ?? '',
				returnType: item.returnType ?? '',
				parameters: Array.isArray(item.parameters) ? item.parameters : [],
				score,
				__familyTie: familyLayer.matchStrength,
				__actionTie: actionLayer.matchStrength,
				__genericStateTie: rankingMetadata.isGenericStateAccessor ? 0 : 1,
			} satisfies RankedSearchItem;
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			if (right.__familyTie !== left.__familyTie) {
				return right.__familyTie - left.__familyTie;
			}
			if (right.__actionTie !== left.__actionTie) {
				return right.__actionTie - left.__actionTie;
			}
			if (right.__genericStateTie !== left.__genericStateTie) {
				return right.__genericStateTie - left.__genericStateTie;
			}
			return left.fullName.localeCompare(right.fullName);
		});
}

// 根据范围返回候选集合。
function getScopedItems(cache: ApiCache, scope: string): ApiProjectionItem[] {
	if (scope === 'callable') {
		return cache.callableItems;
	}
	if (scope === 'type') {
		return cache.typeItems;
	}
	return cache.allItems;
}

// 关键词命中的基础权重。常见词权重更低，减少 get/schematic 这类宽泛词主导排序。
function getKeywordHitWeight(documentFrequency: number): number {
	if (documentFrequency <= 2) {
		return 12;
	}
	if (documentFrequency <= 10) {
		return 9;
	}
	if (documentFrequency <= 30) {
		return 6;
	}
	if (documentFrequency <= 100) {
		return 4;
	}
	if (documentFrequency <= 500) {
		return 2;
	}
	return 1;
}

// 统计查询词在 token 集合中的覆盖数量。
function countUniqueTermMatches(tokens: string[], terms: string[]): number {
	if (tokens.length === 0 || terms.length === 0) {
		return 0;
	}

	const tokenSet = new Set(tokens);
	let matchCount = 0;
	for (const term of new Set(terms)) {
		if (tokenSet.has(term)) {
			matchCount += 1;
		}
	}
	return matchCount;
}

// 判断查询是否与方法名或完整路径精确匹配。
function isExactMatch(searchTokens: SearchTokens, normalizedQuery: string): boolean {
	return searchTokens.normalizedName === normalizedQuery || searchTokens.normalizedFullName === normalizedQuery;
}

// 统计查询词按顺序在 token 序列中的匹配数量。
function countOrderedTermMatches(tokens: string[], terms: string[]): number {
	if (tokens.length === 0 || terms.length === 0) {
		return 0;
	}

	let tokenIndex = 0;
	let matchCount = 0;
	for (const term of terms) {
		let foundIndex = -1;
		for (let index = tokenIndex; index < tokens.length; index += 1) {
			if (tokens[index] === term) {
				foundIndex = index;
				break;
			}
		}
		if (foundIndex < 0) {
			continue;
		}
		matchCount += 1;
		tokenIndex = foundIndex + 1;
	}

	return matchCount;
}

// 针对方法名/完整路径的语义相关性打分。
function scoreSemanticMatch(searchTokens: SearchTokens, normalizedQuery: string, terms: string[]): number {
	let score = 0;
	if (searchTokens.normalizedName === normalizedQuery) {
		score += 90;
	}
	else if (searchTokens.normalizedFullName.includes(normalizedQuery)) {
		score += 60;
	}

	if (searchTokens.normalizedName.includes(normalizedQuery)) {
		score += 45;
	}

	const nameCoverage = countUniqueTermMatches(searchTokens.nameTokens, terms);
	const mergedCoverage = countUniqueTermMatches(searchTokens.mergedTokens, terms);
	const orderedMatches = countOrderedTermMatches(searchTokens.fullNameTokens, terms);

	score += nameCoverage * 8;
	score += mergedCoverage * 3;
	score += orderedMatches * orderedMatches;

	return score;
}

// 在索引不命中时进行候选评分。
function scoreFallback(item: ApiProjectionItem, queryLower: string, terms: string[]): number {
	const name = String(item.name ?? '').toLowerCase();
	const fullName = String(item.fullName ?? '').toLowerCase();
	const summary = String(item.summary ?? '').toLowerCase();

	let score = 0;
	if (fullName.includes(queryLower)) {
		score += 8;
	}
	if (name.includes(queryLower)) {
		score += 6;
	}

	for (const term of terms) {
		if (term.length < 2) {
			continue;
		}
		if (fullName.includes(term)) {
			score += 4;
		}
		if (name.includes(term)) {
			score += 3;
		}
		if (summary.includes(term)) {
			score += 1;
		}
	}

	return score;
}

// 加载并缓存离线文档。
async function loadApiCache(): Promise<ApiCache> {
	if (apiCache) {
		return apiCache;
	}

	const text = await readApiDocumentText().catch((error: unknown) => {
		throw new Error(`离线 API 文档读取失败: ${toSafeErrorMessage(error)}`);
	});

	const parsed = JSON.parse(text) as unknown;
	if (!isPlainObjectRecord(parsed)) {
		throw new Error('离线 API 文档格式非法：根节点必须是对象。');
	}

	const document = parsed as ApiDocument;
	const callableItems = Array.isArray(document.projections?.callableApis) ? document.projections.callableApis : [];
	const typeItems = Array.isArray(document.projections?.types) ? document.projections.types : [];
	const allItems = [...callableItems, ...typeItems];

	const itemById = new Map<number, ApiProjectionItem>();
	const searchTokensById = new Map<number, SearchTokens>();
	const rankingMetadataById = new Map<number, ApiRankingMetadata>();
	for (const item of allItems) {
		const searchTokens = buildSearchTokens(item);
		itemById.set(item.id, item);
		searchTokensById.set(item.id, searchTokens);
		rankingMetadataById.set(item.id, buildApiRankingMetadata(item, searchTokens));
	}

	apiCache = {
		allItems,
		callableItems,
		typeItems,
		itemById,
		keywordIndex: buildKeywordIndex(document.queryIndexes?.symbolIdByKeyword),
		searchTokensById,
		rankingMetadataById,
	};
	return apiCache;
}

/**
 * 处理离线 API 检索任务。
 * @param payload 任务参数。
 * @returns 检索结果。
 */
export async function handleApiSearchTask(payload: unknown): Promise<unknown> {
	if (!isPlainObjectRecord(payload)) {
		throw new Error('api/search 任务参数必须为对象。');
	}

	const query = String(payload.query ?? '').trim();
	if (query.length === 0) {
		throw new Error('api_search 缺少 query 参数。');
	}

	const scope = String(payload.scope ?? 'all').trim().toLowerCase();
	if (!['all', 'callable', 'type'].includes(scope)) {
		throw new Error('scope 仅支持 all/callable/type。');
	}

	const ownerFilter = String(payload.owner ?? '').trim().toLowerCase();
	const limit = parseBoundedIntegerValue(payload.limit, 10, 1, API_SEARCH_MAX_LIMIT);
	const cache = await loadApiCache();
	const terms = splitTerms(query);
	const queryLower = query.toLowerCase();
	const normalizedQuery = normalizeSearchText(query);
	const queryMetadata = buildQueryMetadata(terms);
	const keywordLookupTerms = buildKeywordLookupTerms(terms, normalizedQuery);

	const scopedItems = getScopedItems(cache, scope);
	const ownerScopedItems = ownerFilter.length > 0
		? scopedItems.filter(item => String(item.ownerFullName ?? '').toLowerCase().includes(ownerFilter))
		: scopedItems;
	const allowIdSet = new Set<number>(ownerScopedItems.map(item => item.id));
	const keywordScoreById = new Map<number, number>();

	for (const term of keywordLookupTerms) {
		const ids = cache.keywordIndex.get(term) ?? [];
		const weight = getKeywordHitWeight(ids.length);
		for (const id of ids) {
			if (!allowIdSet.has(id)) {
				continue;
			}
			keywordScoreById.set(id, (keywordScoreById.get(id) ?? 0) + weight);
		}
	}

	const exactMatchItems = ownerScopedItems
		.filter((item) => {
			const searchTokens = cache.searchTokensById.get(item.id);
			return searchTokens ? isExactMatch(searchTokens, normalizedQuery) : false;
		})
		.sort((left, right) => left.fullName.localeCompare(right.fullName));

	if (exactMatchItems.length > 0) {
		const items = exactMatchItems.slice(0, limit).map((item) => {
			return {
				id: item.id,
				name: item.name,
				fullName: item.fullName,
				kind: item.kind,
				ownerFullName: item.ownerFullName,
				summary: item.summary,
				signatureText: item.signatureText ?? '',
				typeText: item.typeText ?? '',
				returnType: item.returnType ?? '',
				parameters: Array.isArray(item.parameters) ? item.parameters : [],
				score: Number.MAX_SAFE_INTEGER,
			};
		});

		return {
			query,
			scope,
			owner: ownerFilter,
			totalCandidates: exactMatchItems.length,
			returnedCount: items.length,
			items,
		};
	}

	// 方法名词位奖励：term 在方法名中出现越靠前，加分越高。
	// 这可确保 getBomFile 等核心 BOM API 排在 getState_AddIntoBom 等属性访问器前面。
	for (const id of keywordScoreById.keys()) {
		const searchTokens = cache.searchTokensById.get(id);
		if (!searchTokens) {
			continue;
		}
		let bonus = 0;
		for (const term of terms) {
			const wordIndex = searchTokens.nameTokens.indexOf(term);
			if (wordIndex >= 0) {
				bonus += Math.max(0, 4 - wordIndex);
			}
		}
		if (bonus > 0) {
			keywordScoreById.set(id, (keywordScoreById.get(id) ?? 0) + bonus);
		}
	}

	const keywordCandidateItems = ownerScopedItems.filter(item => keywordScoreById.has(item.id));
	const candidateItems = keywordCandidateItems.length > 0 ? keywordCandidateItems : ownerScopedItems;
	const allowFallback = keywordCandidateItems.length === 0;

	const rankedItems = rankCandidateItems({
		candidateItems,
		searchTokensById: cache.searchTokensById,
		rankingMetadataById: cache.rankingMetadataById,
		keywordScoreById,
		queryMetadata,
		normalizedQuery,
		queryLower,
		terms,
		allowFallback,
	});
	const items = rankedItems.slice(0, limit).map(({ __familyTie: _familyTie, __actionTie: _actionTie, __genericStateTie: _genericStateTie, ...rest }) => rest);

	return {
		query,
		scope,
		owner: ownerFilter,
		totalCandidates: rankedItems.length,
		returnedCount: items.length,
		items,
	};
}
