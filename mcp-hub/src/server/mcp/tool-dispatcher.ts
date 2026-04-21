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
import {
  handleApiIndex,
  handleApiInvoke,
  handleApiSearch,
  handleEdaContext,
  handleSchematicRead,
  handleSchematicReview,
} from './tool-dispatcher-bridge';
import { getToolDefinitions, isSupportedToolName } from './tool-definition-registry';
import {
  handleComponentPlaceFlow,
  handleComponentSelectFlow,
} from './tool-dispatcher-interactive-tools';
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
  private readonly skippedSelectKeywords = new Set<string>();

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
    if (!isSupportedToolName(toolCallParams.name, this.exposeRawApiTools)) {
      throw new Error(`未知工具: ${toolCallParams.name}`);
    }

    switch (toolCallParams.name) {
      case 'schematic_read':
        return this.toToolContent(await handleSchematicRead());
      case 'schematic_review':
        return this.toToolContent(await handleSchematicReview());
      case 'component_select':
        return this.toToolContent(await handleComponentSelectFlow(args, this.getInteractiveFlowDependencies()));
      case 'component_place':
        return this.toToolContent(await handleComponentPlaceFlow(args, this.getInteractiveFlowDependencies()));
      case 'api_index':
        return this.toToolContent(await handleApiIndex(args));
      case 'api_search':
        return this.toToolContent(await handleApiSearch(args));
      case 'api_invoke':
        return this.toToolContent(await handleApiInvoke(args));
      case 'eda_context':
        return this.toToolContent(await handleEdaContext(args));
      default:
        throw new Error(`未知工具: ${toolCallParams.name}`);
    }
  }

  private getInteractiveFlowDependencies(): {
    interactionChannel: ToolDispatcherInteractionChannel;
    skippedSelectKeywords: Set<string>;
  } {
    return {
      interactionChannel: this.interactionChannel,
      skippedSelectKeywords: this.skippedSelectKeywords,
    };
  }

  private toToolContent(result: unknown): {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: unknown;
  } {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
      structuredContent: result,
    };
  }
}
