import { isPlainObjectRecord } from '../../utils';
import _rawToolDefinitions from '../../data/mcp-tool-definitions.json';
import type { ToolDefinition } from './tool-dispatcher-types';

const EXPOSED_MCP_TOOL_NAMES = new Set<string>([
  'schematic_read',
  'schematic_review',
  'component_select',
  'component_place',
]);

const RAW_API_TOOL_NAMES = new Set<string>([
  'api_index',
  'api_search',
  'eda_context',
  'api_invoke',
]);

const BASE_TOOL_DEFINITIONS = loadToolDefinitions((name) => EXPOSED_MCP_TOOL_NAMES.has(name));
const FULL_TOOL_DEFINITIONS = loadToolDefinitions(
  (name) => EXPOSED_MCP_TOOL_NAMES.has(name) || RAW_API_TOOL_NAMES.has(name),
);

function loadToolDefinitions(predicate: (name: string) => boolean): readonly ToolDefinition[] {
  const parsed: unknown = _rawToolDefinitions;
  if (!Array.isArray(parsed)) {
    throw new Error('工具定义文件格式非法：根节点必须是数组。');
  }

  const definitions: ToolDefinition[] = [];
  for (const item of parsed) {
    if (!isPlainObjectRecord(item)) {
      throw new Error('工具定义项必须为对象。');
    }

    const name = String(item.name ?? '').trim();
    const description = String(item.description ?? '').trim();
    if (name.length === 0 || description.length === 0) {
      throw new Error('工具定义项缺少 name 或 description。');
    }
    if (!isPlainObjectRecord(item.inputSchema)) {
      throw new Error(`工具 ${name} 缺少 inputSchema 对象。`);
    }

    definitions.push({
      name,
      description,
      inputSchema: item.inputSchema,
    });
  }

  return definitions.filter((item) => predicate(item.name));
}

export function getToolDefinitions(exposeRawApiTools: boolean): readonly ToolDefinition[] {
  return exposeRawApiTools ? FULL_TOOL_DEFINITIONS : BASE_TOOL_DEFINITIONS;
}

export function isSupportedToolName(toolName: string, exposeRawApiTools: boolean): boolean {
  return EXPOSED_MCP_TOOL_NAMES.has(toolName) || (exposeRawApiTools && RAW_API_TOOL_NAMES.has(toolName));
}
