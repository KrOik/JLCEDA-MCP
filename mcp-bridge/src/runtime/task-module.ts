import { handleApiIndexTask } from '../mcp/api-index-handler.ts';
import { handleApiSearchTask } from '../mcp/api-search-handler.ts';
import { handleComponentPlaceAutoTask, handlePinNetConfigureTask } from '../mcp/component-automation-handler.ts';
import {
	handleComponentPlaceCheckTask,
	handleComponentPlaceCloseTask,
	handleComponentPlaceStartTask,
	handleComponentPlaceTask,
} from '../mcp/component-place-handler.ts';
import { handleComponentMatchTask, handleComponentSelectTask } from '../mcp/component-select-handler.ts';
import { handleEdaContextTask } from '../mcp/context-handler.ts';
import { handleDocumentFocusTask } from '../mcp/document-focus-handler.ts';
import { handleApiInvokeTask } from '../mcp/invoke-handler.ts';
import { handlePcbConstraintSnapshotTask } from '../mcp/pcb-constraint-handler.ts';
import { handlePcbGeometryAnalyzeTask, handlePcbSnapshotTask } from '../mcp/pcb-geometry-handler.ts';
import { handleSchematicLocateTask } from '../mcp/schematic-locator-handler.ts';
import { handleSchematicReadTask } from '../mcp/schematic-read-handler.ts';
import { handleSchematicReviewTask } from '../mcp/schematic-review-handler.ts';
import { handleSchematicRelayoutTask } from '../mcp/schematic-relayout-handler.ts';
import { setExecutionDeadline } from './execution-guard.ts';
import { handleTypeRowsTask, isRowsIdle, rowsWriteBlocked } from '../mcp/type-rows-handler.ts';
import { isPlacementIdle } from '../mcp/component-place-handler.ts';
export { setOwnershipGuard, getBackgroundState } from '../mcp/type-rows-handler.ts';
export { setExecutionDeadline };
export const abi = 1;
export const isIdle = () => isPlacementIdle() && isRowsIdle();
export const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
	'/bridge/jlceda/schematic/place-rows': handleTypeRowsTask,
	'/bridge/jlceda/document/focus': handleDocumentFocusTask,
	'/bridge/jlceda/component/match': handleComponentMatchTask,
	'/bridge/jlceda/component/place-auto': handleComponentPlaceAutoTask,
	'/bridge/jlceda/schematic/pin-net-configure': handlePinNetConfigureTask,
	'/bridge/jlceda/api/index': handleApiIndexTask,
	'/bridge/jlceda/api/search': handleApiSearchTask,
	'/bridge/jlceda/api/invoke': handleApiInvokeTask,
	'/bridge/jlceda/component/place/check': handleComponentPlaceCheckTask,
	'/bridge/jlceda/component/place/close': handleComponentPlaceCloseTask,
	'/bridge/jlceda/component/place/start': handleComponentPlaceStartTask,
	'/bridge/jlceda/component/place': handleComponentPlaceTask,
	'/bridge/jlceda/component/select': handleComponentSelectTask,
	'/bridge/jlceda/context': handleEdaContextTask,
	'/bridge/jlceda/pcb/constraint/snapshot': handlePcbConstraintSnapshotTask,
	'/bridge/jlceda/pcb/geometry/analyze': handlePcbGeometryAnalyzeTask,
	'/bridge/jlceda/pcb/snapshot': handlePcbSnapshotTask,
	'/bridge/jlceda/schematic/locate': handleSchematicLocateTask,
	'/bridge/jlceda/schematic/read': handleSchematicReadTask,
	'/bridge/jlceda/schematic/review': handleSchematicReviewTask,
	'/bridge/jlceda/schematic/relayout': handleSchematicRelayoutTask,
};
// Background row jobs retain exclusive SDK ownership between short MCP requests.
for (const [path, handler] of Object.entries(handlers)) {
	if (path === '/bridge/jlceda/schematic/place-rows' || path === '/bridge/jlceda/context') continue;
	handlers[path] = async payload => rowsWriteBlocked() ? { ok: false, errorCode: 'ROWS_JOB_OWNS_WRITES', error: 'Use schematic_place_rows action=status; do not replay writes while the row job owns the SDK.' } : handler(payload);
}
