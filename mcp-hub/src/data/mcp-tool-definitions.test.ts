import { describe, expect, it } from 'vitest';

import definitions from './mcp-tool-definitions.json';

describe('mcp-tool-definitions contract', () => {
	it('contains exactly the expected public tool names', () => {
		expect(definitions.map(item => item.name)).toEqual([
			'api_index',
			'api_search',
			'api_invoke',
			'eda_context',
			'schematic_read',
			'schematic_review',
			'component_select',
			'component_place',
		]);
	});

	it('ensures required-argument contracts for key tools stay intact', () => {
		const byName = new Map(definitions.map(item => [item.name, item]));

		expect(byName.get('api_search')?.inputSchema.required).toEqual(['query']);
		expect(byName.get('api_invoke')?.inputSchema.required).toEqual(['apiFullName']);
		expect(byName.get('component_select')?.inputSchema.required).toEqual(['keyword']);
		expect(byName.get('component_place')?.inputSchema.required).toEqual(['components']);
	});

	it('keeps timeout and paging bounds aligned with runtime expectations', () => {
		const byName = new Map(definitions.map(item => [item.name, item]));
		const apiSearchLimit = byName.get('api_search')?.inputSchema.properties?.limit as Record<string, unknown>;
		const apiInvokeTimeout = byName.get('api_invoke')?.inputSchema.properties?.timeoutMs as Record<string, unknown>;
		const componentSelectLimit = byName.get('component_select')?.inputSchema.properties?.limit as Record<string, unknown>;
		const componentPlaceTimeout = byName.get('component_place')?.inputSchema.properties?.timeoutSeconds as Record<string, unknown>;

		expect(apiSearchLimit.minimum).toBe(1);
		expect(apiSearchLimit.maximum).toBe(50);
		expect(apiInvokeTimeout.minimum).toBe(1000);
		expect(apiInvokeTimeout.maximum).toBe(120000);
		expect(componentSelectLimit.minimum).toBe(2);
		expect(componentSelectLimit.maximum).toBe(20);
		expect(componentPlaceTimeout.minimum).toBe(30);
		expect(componentPlaceTimeout.maximum).toBe(180);
	});
});
