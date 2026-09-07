import { isPlainObjectRecord } from '../utils';

/** Explicit, observable page activation. OS foreground focus is not promised by this API. */
export async function handleDocumentFocusTask(payload: unknown): Promise<unknown> {
	if (!isPlainObjectRecord(payload) || typeof payload.documentUuid !== 'string' || !payload.documentUuid.trim()) {
		throw new TypeError('documentUuid 必须为明确的目标文档 UUID');
	}
	const uuid = payload.documentUuid.trim();
	const tabId = await eda.dmt_EditorControl.openDocument(uuid);
	if (!tabId || !await eda.dmt_EditorControl.activateDocument(tabId)) {
		return { ok: false, errorCode: 'ACTIVATION_FAILED', documentUuid: uuid };
	}
	const current = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	return { ok: current?.uuid === uuid, executionState: current?.uuid === uuid ? 'confirmed' : 'unconfirmed', documentUuid: uuid, currentDocument: current, tabId };
}
