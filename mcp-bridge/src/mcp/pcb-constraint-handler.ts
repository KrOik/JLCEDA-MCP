import { PCB_CONSTRAINT_ENGINE_PLUGIN_ID } from '../../../shared/pcb-constraint-engine.ts';
import { bridgePluginRegistry } from '../plugins/plugin-registry.ts';

function ensureObjectPayload(payload: unknown, taskName: string): Record<string, unknown> {
	if (payload == null) {
		return {};
	}
	if (typeof payload !== 'object' || Array.isArray(payload)) {
		throw new TypeError(`${taskName} 任务参数必须为对象。`);
	}
	return payload as Record<string, unknown>;
}

export async function handlePcbConstraintSnapshotTask(payload: unknown): Promise<unknown> {
	return await bridgePluginRegistry.execute(
		PCB_CONSTRAINT_ENGINE_PLUGIN_ID,
		'snapshot',
		ensureObjectPayload(payload, 'pcb/constraint/snapshot'),
	);
}
