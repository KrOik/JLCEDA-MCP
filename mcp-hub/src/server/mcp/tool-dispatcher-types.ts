import type {
  SidebarInteractionRequest,
  SidebarInteractionResponse,
} from '../../state/sidebar-interaction';

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const DEFAULT_BRIDGE_TIMEOUT_MS = 15_000;
export const SIDEBAR_INTERACTION_TIMEOUT_MS = 15 * 60 * 1000;
export const COMPONENT_PLACE_CHECK_INTERVAL_MS = 400;

export interface ToolDispatcherInteractionChannel {
  publish(request: SidebarInteractionRequest | null): void;
  waitForResponse(
    requestId: string,
    acceptedActions: SidebarInteractionResponse['action'][],
    timeoutMs: number,
  ): Promise<SidebarInteractionResponse>;
  tryConsumeResponse(
    requestId: string,
    acceptedActions: SidebarInteractionResponse['action'][],
  ): SidebarInteractionResponse | null;
}

export class NoopInteractionChannel implements ToolDispatcherInteractionChannel {
  public publish(): void {
    return;
  }

  public tryConsumeResponse(): SidebarInteractionResponse | null {
    return null;
  }

  public async waitForResponse(): Promise<SidebarInteractionResponse> {
    throw new Error('宿主交互通道未就绪，无法继续当前交互流程。');
  }
}
