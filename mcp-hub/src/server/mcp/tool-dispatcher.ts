/**
 * ------------------------------------------------------------------------
 * 名称：MCP 工具分发器
 * 说明：按工具名分发到检索或桥接执行路径。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-12
 * 备注：所有桥接任务仅发送到服务端判定的活动客户端。
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord } from '../../utils';
import { enqueueBridgeRequest } from '../bridge/broker';
import { getBridgeStatus } from '../bridge/broker';
import { bridgeRequestContext } from '../bridge/request-context';
import {
  handleApiIndex,
  handleApiInvoke,
  handleApiSearch,
  handlePcbConstraintSnapshot,
  handleEdaContext,
  handlePcbGeometryAnalyze,
  handlePcbSnapshot,
  handleSchematicLocate,
  handleSchematicRead,
  handleSchematicRelayout,
  handleSchematicReview,
} from './tool-dispatcher-bridge';
import { getToolDefinitions, isSupportedToolName } from './tool-definition-registry';
import { componentSearchCoordinator } from './search-coordinator';
import { CandidateStore } from './candidate-store';
import { compactResult, ResponseStore } from './response-store';
import {
  NoopInteractionChannel,
  type ToolCallParams,
  type ToolDefinition,
  type ToolDispatcherInteractionChannel,
} from './tool-dispatcher-types';

export type {
  ToolCallParams,
  ToolDefinition,
  ToolDispatcherInteractionChannel,
} from './tool-dispatcher-types';

export class ToolDispatcher {
  private readonly candidates = new CandidateStore();
  private readonly responses = new ResponseStore();
  public constructor(
    private readonly storageDirectoryPath: string,
    private readonly sessionId: string,
    private exposeRawApiTools: boolean = false,
    private readonly interactionChannel: ToolDispatcherInteractionChannel = new NoopInteractionChannel(),
  ) { }

  public getToolDefinitions(): readonly ToolDefinition[] {
    return getToolDefinitions(this.exposeRawApiTools);
  }

  public updateExposeRawApiTools(value: boolean): void {
    this.exposeRawApiTools = value;
  }

  public async dispatch(toolCallParams: ToolCallParams): Promise<unknown> {
    const args = isPlainObjectRecord(toolCallParams.arguments) ? toolCallParams.arguments : {};
    if (args.responseDetail !== undefined && !['compact', 'full'].includes(String(args.responseDetail))) throw new Error('responseDetail 必须为 compact/full');
    const response = await bridgeRequestContext.run({
      targetClientId: typeof args.targetClientId === 'string' ? args.targetClientId : undefined,
      targetDocumentUuid: typeof args.targetDocumentUuid === 'string' ? args.targetDocumentUuid : undefined,
    }, () => this.dispatchInternal(toolCallParams));
    const raw = (response as { structuredContent: unknown }).structuredContent;
    if (toolCallParams.name === 'result_read') return { content: [{ type: 'text', text: JSON.stringify(raw) }], isError: isPlainObjectRecord(raw) && raw.ok === false };
    if (args.responseDetail === 'full') return response;
    let compact = compactResult(toolCallParams.name, raw);
    if (toolCallParams.name === 'component_select') {
      compact = isPlainObjectRecord(raw) && Array.isArray(raw.searches)
        ? { ...raw, searches: raw.searches.map(item => this.candidates.present(item)) }
        : this.candidates.present(raw);
    }
    const changed = JSON.stringify(compact) !== JSON.stringify(raw);
    const large = JSON.stringify(compact)?.length > 8000;
    const ref = toolCallParams.name !== 'bridge_status' && (changed || large) ? this.responses.save(raw) : undefined;
    if (large && ref && isPlainObjectRecord(compact) && compact.ok !== false && !['component_place', 'pin_net_configure', 'component_select'].includes(toolCallParams.name)) {
      compact = { ok: compact.ok, summary: compact.summary, warnings: compact.warnings, error: compact.error, jobId: compact.jobId, state: compact.state, phase: compact.phase, progress: compact.progress, documentUuid: compact.documentUuid, detailOmitted: true };
    }
    if (ref && isPlainObjectRecord(compact)) compact = { ...compact, resultRef: ref };
    else if (changed && toolCallParams.name !== 'bridge_status' && isPlainObjectRecord(compact)) compact = { ...compact, detailUnavailable: true };
    return { content: [{ type: 'text', text: JSON.stringify(compact) }], isError: (response as { isError: boolean }).isError };
  }

  private async dispatchInternal(toolCallParams: ToolCallParams): Promise<unknown> {
    const args = isPlainObjectRecord(toolCallParams.arguments) ? toolCallParams.arguments : {};
    if (!isSupportedToolName(toolCallParams.name, this.exposeRawApiTools)) {
      throw new Error(`未知工具: ${toolCallParams.name}`);
    }

    switch (toolCallParams.name) {
      case 'result_read':
        return this.toToolContent(this.responses.read(args));
      case 'bridge_status':
        return this.toToolContent(getBridgeStatus());
      case 'document_focus':
        return this.toToolContent(await enqueueBridgeRequest('/bridge/jlceda/document/focus', args, 15000));
      case 'schematic_read':
        return this.toToolContent(await handleSchematicRead(args));
      case 'schematic_locate':
        return this.toToolContent(await handleSchematicLocate(args));
      case 'schematic_review':
        return this.toToolContent(await handleSchematicReview());
      case 'schematic_relayout':
        return this.toToolContent(await handleSchematicRelayout(args));
      case 'pcb_snapshot':
        return this.toToolContent(await handlePcbSnapshot(args));
      case 'pcb_geometry_analyze':
        return this.toToolContent(await handlePcbGeometryAnalyze(args));
      case 'pcb_constraint_snapshot':
        return this.toToolContent(await handlePcbConstraintSnapshot(args));
      case 'component_select': {
        // Validate the whole batch before searching; user input errors are
        // recoverable tool results, not opaque JSON-RPC transport failures.
        let queries: Record<string, unknown>[];
        try {
          if (args.queries !== undefined) {
            if (!Array.isArray(args.queries) || args.queries.length < 1 || args.queries.length > 10 || args.keyword !== undefined) throw new Error('queries 必须为 1-10 项，不能同时传 keyword');
            queries = args.queries.map((query, index) => {
              try { return this.searchArgs(typeof query === 'string' ? { keyword: query } : query); }
              catch (error) { throw new Error(`queries[${index}]: ${error instanceof Error ? error.message : String(error)}`); }
            });
          } else queries = [this.searchArgs(args)];
        } catch (error) {
          return this.toToolContent({ ok: false, errorCode: 'INVALID_ARGUMENT', executed: false,
            error: error instanceof Error ? error.message : String(error),
            examples: [{ keyword: '100nF 0603' }, { queries: [{ keyword: '100nF 0603' }, { keyword: '10kΩ 0603' }] }] });
        }
        if (args.queries !== undefined) {
          const searches: unknown[] = [];
          for (const [index, query] of queries.entries()) {
            let value: unknown;
            try { value = await this.search(query, args); }
            catch (error) { value = { ok: false, errorCode: 'SEARCH_FAILED', error: error instanceof Error ? error.message : String(error) }; }
            searches.push({ ...(value as object), index });
            if (isPlainObjectRecord(value) && value.ok === false && value.errorCode !== 'NO_MATCH') break;
          }
          return this.toToolContent({ ok: searches.length === queries.length && searches.every(s => (s as { ok?: boolean }).ok === true), searches, remainingIndices: queries.flatMap((_, i) => (searches[i] as { ok?: boolean } | undefined)?.ok === true ? [] : [i]) });
        }
        return this.toToolContent(await this.search(queries[0], args));
      }
      case 'component_place':
        return this.toToolContent(await enqueueBridgeRequest('/bridge/jlceda/component/place-auto', { ...args, components: this.candidates.expand(args.components) }, 120000));
      case 'schematic_place_rows':
        return this.toToolContent(await enqueueBridgeRequest('/bridge/jlceda/schematic/place-rows', args.action === 'status' ? args : { ...args, components: this.candidates.expand(args.components, true) }, 15000));
      case 'pin_net_configure':
        return this.toToolContent(await enqueueBridgeRequest('/bridge/jlceda/schematic/pin-net-configure', args, 120000));
      case 'api_index':
        return this.toToolContent(await handleApiIndex(args));
      case 'api_search':
        return this.toToolContent(await handleApiSearch(args));
      case 'api_invoke':
        if (String(args.apiFullName).trim().toLowerCase() === 'eda.lib_device.search') {
          return this.toToolContent(await componentSearchCoordinator.run(JSON.stringify(['raw-search', this.sessionId, args.args]), () => handleApiInvoke(args)));
        }
        return this.toToolContent(await handleApiInvoke(args));
      case 'eda_context':
        return this.toToolContent(await handleEdaContext(args));
      default:
        throw new Error(`未知工具: ${toolCallParams.name}`);
    }
  }

  private searchArgs(raw: unknown): Record<string, unknown> {
    if (!isPlainObjectRecord(raw) || typeof raw.keyword !== 'string' || !raw.keyword.trim()) throw new Error('component_select 缺少 keyword 参数。');
    const limit = raw.limit ?? 5; const page = raw.page ?? 1;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 2 || limit > 20 || typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 9999) throw new Error('limit/page 超出范围');
    if (raw.inStockOnly !== undefined && typeof raw.inStockOnly !== 'boolean') throw new Error('inStockOnly 必须为 boolean');
    const query: Record<string, unknown> = { keyword: raw.keyword.trim().replace(/\s+/g, ' '), limit, page };
    for (const key of ['manufacturerId', 'supplierId', 'footprintName']) {
      if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`${key} 必须为字符串`);
      if (typeof raw[key] === 'string' && raw[key].trim()) query[key] = raw[key].trim();
    }
    if (raw.inStockOnly !== undefined) query.inStockOnly = raw.inStockOnly;
    return query;
  }

  private search(query: Record<string, unknown>, context: Record<string, unknown>) {
    const key = JSON.stringify([this.sessionId, context.targetClientId ?? '', context.targetDocumentUuid ?? '', query]);
    return componentSearchCoordinator.run(key, () => enqueueBridgeRequest('/bridge/jlceda/component/match', query, 30000));
  }

  private toToolContent(result: unknown): {
    isError: boolean;
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: unknown;
  } {
    return {
      isError: isPlainObjectRecord(result) && (result.ok === false || result.timeout === true),
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
      structuredContent: result,
    };
  }
}
