#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

process.env.TS_NODE_SKIP_PROJECT = 'true';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
	module: 'commonjs',
	moduleResolution: 'node',
	target: 'es2022',
});
require('ts-node/register/transpile-only');

const OFFLINE_DOC_PATH = path.resolve(__dirname, '../resources/jlceda-pro-api-doc.json');
const API_DOC_URI = '/resources/jlceda-pro-api-doc.json';

const QUERY_CASES = [
	{
		query: 'get current schematic page info',
		scope: 'callable',
		expectedAny: ['eda.dmt_Schematic.getCurrentSchematicPageInfo'],
	},
	{
		query: 'getCurrentSchematicPageInfo',
		scope: 'callable',
		expectedAny: ['eda.dmt_Schematic.getCurrentSchematicPageInfo'],
	},
	{
		query: 'current rule configuration name',
		scope: 'callable',
		expectedAny: ['eda.pcb_Drc.getCurrentRuleConfigurationName'],
	},
	{
		query: 'remove schematic page',
		scope: 'callable',
		expectedAny: ['eda.dmt_Schematic.deleteSchematicPage'],
	},
	{
		query: 'event listener already exist remove',
		scope: 'callable',
		expectedAny: ['eda.pcb_Event.removeEventListener', 'eda.sch_Event.removeEventListener'],
	},
	{
		query: 'mouse current schematic info',
		scope: 'callable',
		expectedAny: ['eda.sch_SelectControl.getCurrentMousePosition', 'eda.pcb_SelectControl.getCurrentMousePosition'],
	},
	{
		query: 'split screen',
		scope: 'callable',
		expectedAny: ['eda.dmt_EditorControl.getSplitScreenTree'],
	},
	{
		query: 'calculating ratline',
		scope: 'callable',
		expectedAny: ['eda.pcb_Document.startCalculatingRatline'],
	},
	{
		query: 'bom',
		scope: 'callable',
		expectedAny: ['eda.sch_ManufactureData.getBomFile', 'eda.pcb_ManufactureData.getBomFile'],
	},
];

function createOfflineDocFile(text) {
	return {
		async text() {
			return text;
		},
	};
}

async function main() {
	const offlineDocText = await fs.readFile(OFFLINE_DOC_PATH, 'utf8');
	globalThis.eda = {
		sys_FileSystem: {
			async getExtensionFile(uri) {
				if (uri !== API_DOC_URI) {
					return undefined;
				}
				return createOfflineDocFile(offlineDocText);
			},
		},
	};

	const { handleApiSearchTask } = require(path.resolve(__dirname, '../src/mcp/api-search-handler.ts'));
	const rows = [];

	for (const item of QUERY_CASES) {
		const startedAt = performance.now();
		const result = await handleApiSearchTask({
			query: item.query,
			scope: item.scope,
			limit: 10,
		});
		const elapsedMs = performance.now() - startedAt;
		const names = Array.isArray(result?.items)
			? result.items.map(entry => String(entry?.fullName ?? ''))
			: [];
		const rank = names.findIndex(name => item.expectedAny.includes(name));
		const mrr = rank >= 0 ? 1 / (rank + 1) : 0;

		rows.push({
			query: item.query,
			expectedAny: item.expectedAny,
			top3: names.slice(0, 3),
			top1Hit: rank === 0 ? 1 : 0,
			top3Hit: rank >= 0 && rank < 3 ? 1 : 0,
			mrr,
			ms: elapsedMs,
			rank: rank >= 0 ? rank + 1 : null,
		});
	}

	for (const row of rows) {
		const rankText = row.rank === null ? 'not_found' : `rank_${row.rank}`;
		console.log(`query: ${row.query}`);
		console.log(`expected_any: ${row.expectedAny.join(' | ')}`);
		console.log(`top3: ${row.top3.join(' | ')}`);
		console.log(`match: ${rankText}, ms=${row.ms.toFixed(2)}`);
		console.log('');
	}

	const total = rows.length;
	const top1 = rows.reduce((sum, row) => sum + row.top1Hit, 0);
	const top3 = rows.reduce((sum, row) => sum + row.top3Hit, 0);
	const mrr = rows.reduce((sum, row) => sum + row.mrr, 0) / total;
	const avgMs = rows.reduce((sum, row) => sum + row.ms, 0) / total;
	const firstQueryMs = rows[0]?.ms ?? 0;
	const warmRows = rows.slice(1);
	const avgWarmMs = warmRows.length > 0
		? warmRows.reduce((sum, row) => sum + row.ms, 0) / warmRows.length
		: firstQueryMs;
	const failedTop1Rows = rows.filter(row => row.top1Hit === 0);
	const failedTop3Rows = rows.filter(row => row.top3Hit === 0);

	console.log('summary');
	console.log(`queries: ${total}`);
	console.log(`top1: ${(top1 / total).toFixed(4)} (${top1}/${total})`);
	console.log(`top3: ${(top3 / total).toFixed(4)} (${top3}/${total})`);
	console.log(`mrr: ${mrr.toFixed(4)}`);
	console.log(`average_ms_per_query: ${avgMs.toFixed(2)}`);
	console.log(`first_query_ms: ${firstQueryMs.toFixed(2)}`);
	console.log(`average_warm_ms_per_query: ${avgWarmMs.toFixed(2)}`);
	console.log(`top1_miss_count: ${failedTop1Rows.length}`);
	console.log(`top3_miss_count: ${failedTop3Rows.length}`);
	if (failedTop1Rows.length > 0) {
		console.log('failed_cases_top1:');
		for (const row of failedTop1Rows) {
			console.log(`- query="${row.query}" expected_any="${row.expectedAny.join(' | ')}" observed_top3="${row.top3.join(' | ')}" rank=${row.rank === null ? 'not_found' : row.rank}`);
		}
	}
	if (failedTop3Rows.length > 0) {
		console.log('failed_cases_top3:');
		for (const row of failedTop3Rows) {
			console.log(`- query="${row.query}" expected_any="${row.expectedAny.join(' | ')}" observed_top3="${row.top3.join(' | ')}"`);
		}
	}
}

main().catch((error) => {
	console.error('api-search-bench failed');
	console.error(error);
	process.exitCode = 1;
});
