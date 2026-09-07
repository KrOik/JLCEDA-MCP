import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-call routing, never a process-global client selection shared across agents. */
export const bridgeRequestContext = new AsyncLocalStorage<{ targetClientId?: string; targetDocumentUuid?: string }>();
