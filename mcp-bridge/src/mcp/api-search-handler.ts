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

interface EdaFileSystem {
	getExtensionFile: (uri: string) => Promise<File | undefined>;
}

const API_SEARCH_MAX_LIMIT = 50;
const API_DOCUMENT_URI = '/resources/jlceda-pro-api-doc.json';

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
	for (const item of allItems) {
		itemById.set(item.id, item);
		searchTokensById.set(item.id, buildSearchTokens(item));
	}

	apiCache = {
		allItems,
		callableItems,
		typeItems,
		itemById,
		keywordIndex: buildKeywordIndex(document.queryIndexes?.symbolIdByKeyword),
		searchTokensById,
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

	const scopedItems = getScopedItems(cache, scope);
	const ownerScopedItems = ownerFilter.length > 0
		? scopedItems.filter(item => String(item.ownerFullName ?? '').toLowerCase().includes(ownerFilter))
		: scopedItems;
	const allowIdSet = new Set<number>(ownerScopedItems.map(item => item.id));
	const keywordScoreById = new Map<number, number>();

	for (const term of terms) {
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

	const filteredItems = candidateItems
		.map((item) => {
			const searchTokens = cache.searchTokensById.get(item.id);
			if (!searchTokens) {
				return null;
			}

			const keywordScore = keywordScoreById.get(item.id) ?? 0;
			const semanticScore = scoreSemanticMatch(searchTokens, normalizedQuery, terms);
			const fallbackScore = allowFallback && keywordScore === 0 && semanticScore === 0 ? scoreFallback(item, queryLower, terms) : 0;
			const score = keywordScore + semanticScore + fallbackScore;
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
			};
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.fullName.localeCompare(right.fullName);
		});
	const items = filteredItems.slice(0, limit);

	return {
		query,
		scope,
		owner: ownerFilter,
		totalCandidates: filteredItems.length,
		returnedCount: items.length,
		items,
	};
}
