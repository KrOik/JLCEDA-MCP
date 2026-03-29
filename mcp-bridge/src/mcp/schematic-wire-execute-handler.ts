/**
 * ------------------------------------------------------------------------
 * 名称：桥接连线执行任务处理
 * 说明：按 planId 取出规划好的连线坐标，逐条执行导线或网络标签连接，
 *       每条完成后进行创建结果验证，失败时回滚已创建的图元，最后运行 ERC。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-29
 * 备注：仅处理 schematic/wire/execute 任务。AI 始终无法获取或修改坐标。
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord, safeCall } from '../utils';
import { getWirePlan } from './schematic-wire-plan-store';

// 单条连接的执行结果。
interface ConnectionResult {
	index: number;
	fromLabel: string;
	toLabel: string;
	netName: string;
	method: 'wire' | 'net-label';
	status: 'success' | 'failed';
	errorMessage?: string;
}

// 网络标签图元实例（仅使用实例 delete 方法时需要持有引用）。
interface NetLabelPrimitive {
	delete: () => boolean;
}

// 尝试通过实例方法删除属性图元（net label）。
function tryDeleteAttributePrimitive(primitive: unknown): void {
	if (!primitive || typeof (primitive as Record<string, unknown>).delete !== 'function') {
		return;
	}
	try {
		(primitive as NetLabelPrimitive).delete();
	}
	catch { /* 回滚失败时静默忽略 */ }
}

// 计算两点间的曼哈顿折线路径（根据目标引脚方向决定接近策略，避免路径穿越目标器件其他引脚）。
// 核心规则：最后一段垂直/水平地抵达目标引脚端面，绕开同器件其他引脚。
//   目标引脚为水平（0°/180°）：从上方或下方垂直接近 → 先横后竖
//   目标引脚为垂直（90°/270°）：从侧面水平接近   → 先竖后横
// EDA 坐标系：Y 轴向上为正（y 越大越高）。
function buildManhattanPath(
	x1: number, y1: number,
	x2: number, y2: number,
	_fromOrientationDeg: number,
	toOrientationDeg: number,
): number[] {
	// 若已在同一水平或垂直方向，直接返回直线。
	if (x1 === x2 || y1 === y2) {
		return [x1, y1, x2, y2];
	}

	const normTo = ((toOrientationDeg % 360) + 360) % 360;

	// 水平目标引脚（0° 或 180°）：先横后竖，最后竖段垂直接近，避免横段经过同行相邻引脚。
	if (normTo === 0 || normTo === 180) {
		return [x1, y1, x2, y1, x2, y2];
	}

	// 垂直目标引脚（90° 或 270°）：先竖后横，最后横段水平接近，避免竖段经过同列相邻引脚。
	return [x1, y1, x1, y2, x2, y2];
}

// 执行单条网络标签连接，返回是否成功。
async function executeNetLabelConnection(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	netName: string,
): Promise<{ success: boolean; errorMessage?: string }> {
	// 在 from 端点放置网络标签。
	const fromLabel = await safeCall<unknown>(() =>
		Promise.resolve(eda.sch_PrimitiveAttribute.createNetLabel(fromX, fromY, netName)),
	);

	if (fromLabel === undefined || fromLabel === null) {
		return { success: false, errorMessage: `从端（${String(fromX)}, ${String(fromY)}）放置网络标签失败，API 返回 undefined。` };
	}

	// 在 to 端点放置网络标签。
	const toLabel = await safeCall<unknown>(() =>
		Promise.resolve(eda.sch_PrimitiveAttribute.createNetLabel(toX, toY, netName)),
	);

	if (toLabel === undefined || toLabel === null) {
		// to 端失败时回滚已创建的 from 端标签。
		tryDeleteAttributePrimitive(fromLabel);
		return { success: false, errorMessage: `至端（${String(toX)}, ${String(toY)}）放置网络标签失败，API 返回 undefined；已回滚从端标签。` };
	}

	return { success: true };
}

// 执行单条导线连接，返回是否成功。
async function executeWireConnection(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	netName: string,
	fromOrientationDeg: number,
	toOrientationDeg: number,
): Promise<{ success: boolean; errorMessage?: string }> {
	const path = buildManhattanPath(fromX, fromY, toX, toY, fromOrientationDeg, toOrientationDeg);

	const wireResult = await safeCall<unknown>(() =>
		Promise.resolve(eda.sch_PrimitiveWire.create(path, netName)),
	);

	if (wireResult === undefined || wireResult === null) {
		return { success: false, errorMessage: `导线创建失败，sch_PrimitiveWire.create 返回 undefined。坐标：[${path.join(', ')}]。` };
	}

	return { success: true };
}

/**
 * 处理连线执行任务。
 * @param payload 任务参数，包含 planId 和 connectionMethod。
 * @returns 每条连接的执行结果及最终 ERC 状态。
 */
export async function handleSchematicWireExecuteTask(payload: unknown): Promise<unknown> {
	if (!isPlainObjectRecord(payload)) {
		return { ok: false, error: 'schematic/wire/execute 任务参数必须为对象。' };
	}

	const planId = String(payload.planId ?? '').trim();
	if (planId.length === 0) {
		return { ok: false, error: '缺少 planId 参数。' };
	}

	const connectionMethodRaw = String(payload.connectionMethod ?? '').trim().toLowerCase();
	if (connectionMethodRaw !== 'wire' && connectionMethodRaw !== 'net-label') {
		return { ok: false, error: `connectionMethod 必须为 "wire" 或 "net-label"，收到："${connectionMethodRaw}"。` };
	}
	const connectionMethod = connectionMethodRaw as 'wire' | 'net-label';

	const plan = getWirePlan(planId);
	if (!plan) {
		return { ok: false, error: `未找到 planId 为 "${planId}" 的连线规划。该规划可能已过期（超过 30 分钟），请重新调用 schematic_wire_plan 生成规划。` };
	}

	const results: ConnectionResult[] = [];
	let successCount = 0;
	let failedCount = 0;

	for (let index = 0; index < plan.connections.length; index += 1) {
		const conn = plan.connections[index];
		const fromLabel = `${conn.fromRefDes} 引脚 ${conn.fromPin}`;
		const toLabel = `${conn.toRefDes} 引脚 ${conn.toPin}`;

		let execResult: { success: boolean; errorMessage?: string };

		if (connectionMethod === 'net-label') {
			execResult = await executeNetLabelConnection(
				conn.fromX_mil,
				conn.fromY_mil,
				conn.toX_mil,
				conn.toY_mil,
				conn.netName,
			);
		}
		else {
			execResult = await executeWireConnection(
				conn.fromX_mil,
				conn.fromY_mil,
				conn.toX_mil,
				conn.toY_mil,
				conn.netName,
				conn.fromOrientationDeg,
				conn.toOrientationDeg,
			);
		}

		if (execResult.success) {
			successCount += 1;
			results.push({ index, fromLabel, toLabel, netName: conn.netName, method: connectionMethod, status: 'success' });
		}
		else {
			failedCount += 1;
			results.push({
				index,
				fromLabel,
				toLabel,
				netName: conn.netName,
				method: connectionMethod,
				status: 'failed',
				errorMessage: execResult.errorMessage,
			});
		}
	}

	// 执行完毕后运行 ERC，获取整体连接质量反馈。
	const ercRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_Drc.check(false, false, true)));
	const ercPassed = ercRaw === true;

	return {
		ok: true,
		planId,
		connectionMethod,
		totalConnections: plan.connections.length,
		successCount,
		failedCount,
		results,
		erc: { passed: ercPassed, rawResult: ercRaw },
		message: failedCount === 0
			? `全部 ${String(plan.connections.length)} 条连线执行完成。ERC 状态：${ercPassed ? '通过' : '存在错误，请检查原理图'}.`
			: `${String(successCount)} / ${String(plan.connections.length)} 条连线成功，${String(failedCount)} 条失败。请检查失败原因后重新规划失败的连线。`,
	};
}
