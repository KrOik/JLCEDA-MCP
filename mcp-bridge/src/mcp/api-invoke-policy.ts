import { isPlainObjectRecord } from '../utils';

/**
 * Raw API is useful for inspection and for the narrowly scoped recovery path,
 * but must not become a second, unchecked schematic-placement implementation.
 */
const PROTECTED_PLACEMENT_CALLS = new Set([
	'eda.sch_document.autolayout',
	'eda.sch_primitivecomponent.create',
	'eda.sch_primitivecomponent.modifyposition',
	'eda.sch_primitivecomponent.move',
	'eda.sch_primitivewire.modify',
]);

export function assertApiInvokeAllowed(apiFullName: string, args: unknown[]): void {
	const normalized = apiFullName.trim().toLowerCase();
	if (PROTECTED_PLACEMENT_CALLS.has(normalized))
		throw new Error(`PROTECTED_PLACEMENT_API: ${apiFullName} 会绕过 component_place 的真实尺寸、碰撞和回读保护；请使用 component_place，已有连线图页请先使用 schematic_relayout 预览。`);
	// The SDK exposes a generic Component.modify(id, patch).  Only block patches
	// that move geometry; metadata edits remain available to the raw API workflow.
	if (normalized === 'eda.sch_primitivecomponent.modify' && isPlainObjectRecord(args[1])
		&& ('x' in args[1] || 'y' in args[1] || 'rotation' in args[1] || 'mirror' in args[1])) {
		throw new Error(`PROTECTED_PLACEMENT_API: ${apiFullName} 的几何修改会绕过 component_place；请使用 component_place 或 schematic_relayout。`);
	}
}
