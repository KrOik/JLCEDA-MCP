/**
 * ------------------------------------------------------------------------
 * 名称：桥接连线规划任务处理
 * 说明：接收 AI 的逻辑连接声明，从原理图拓扑中自动解析精确坐标，执行前置
 *       安全校验，校验通过后生成 planId 供执行阶段使用。AI 始终无法获取坐标。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-29
 * 备注：仅处理 schematic/wire/plan 任务。
 * ------------------------------------------------------------------------
 */

import { isPlainObjectRecord, safeCall } from '../utils';
import { createWirePlan } from './schematic-wire-plan-store';

// WireConnection 仅用于类型注解，从 createWirePlan 参数类型派生，避免双导入冲突。
type WireConnection = Parameters<typeof createWirePlan>[0][number];

// 安全调用同步 getter 方法，获取指定类型的值。
function sg<T>(obj: unknown, method: string, fallback: T): T {
	try {
		const fn = (obj as Record<string, unknown>)?.[method];
		if (typeof fn === 'function') {
			const result: unknown = (fn as () => unknown).call(obj);
			return result != null ? result as T : fallback;
		}
	}
	catch { /* 忽略异常 */ }
	return fallback;
}

// 引脚信息内部结构。
interface InternalPinInfo {
	refDes: string;
	pinSignalName: string;
	pinPadNumber: string;
	electricalType: string;
	hasNoConnectMark: boolean;
	wireConnectionX_mil: number;
	wireConnectionY_mil: number;
	orientationDeg: number;
}

// AI 传入的单条连接声明。
interface ConnectionDeclaration {
	from: { refDes: string; pin: string };
	to: { refDes: string; pin: string };
	netName: string;
}

// 校验错误结构。
interface ValidationError {
	index: number;
	code: string;
	message: string;
}

// 构建引脚查找表：键为 "REFDES:PINPAD" 或 "REFDES:PINSIGNAL"（均小写）。
async function buildPinLookup(): Promise<Map<string, InternalPinInfo> | { error: string }> {
	const componentListRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_PrimitiveComponent.getAll(undefined, true)));
	if (!Array.isArray(componentListRaw)) {
		return { error: '器件列表获取失败，sch_PrimitiveComponent.getAll 未返回数组。' };
	}

	const lookup = new Map<string, InternalPinInfo>();

	for (const rawComponent of componentListRaw) {
		const refDes = sg<string>(rawComponent, 'getState_Designator', '').trim();
		const netFlagName = sg<string>(rawComponent, 'getState_Net', '').trim();

		if (refDes.length > 0) {
			// 普通器件：通过 getAllPinsByPrimitiveId 读取引脚。
			const primitiveId = sg<string>(rawComponent, 'getState_PrimitiveId', '');
			const pinsRaw = await safeCall<unknown>(() => Promise.resolve(eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId)));
			if (!Array.isArray(pinsRaw)) {
				continue;
			}

			for (const rawPin of pinsRaw) {
				const pinSignalName = sg<string>(rawPin, 'getState_PinName', '').trim();
				const pinPadNumber = sg<string>(rawPin, 'getState_PinNumber', '').trim();
				const electricalType = sg<string>(rawPin, 'getState_PinType', '').trim();
				const hasNoConnectMark = sg<boolean>(rawPin, 'getState_NoConnected', false);
				const wireConnectionX_mil = sg<number>(rawPin, 'getState_X', 0);
				const wireConnectionY_mil = sg<number>(rawPin, 'getState_Y', 0);
				const orientationDeg = sg<number>(rawPin, 'getState_Rotation', 0);

				const info: InternalPinInfo = {
					refDes,
					pinSignalName,
					pinPadNumber,
					electricalType,
					hasNoConnectMark,
					wireConnectionX_mil,
					wireConnectionY_mil,
					orientationDeg,
				};

				// 用 pinPadNumber 和 pinSignalName 两种键都注册，均转小写以便大小写不敏感匹配。
				const refDesLower = refDes.toLowerCase();
				if (pinPadNumber.length > 0) {
					lookup.set(`${refDesLower}:${pinPadNumber.toLowerCase()}`, info);
				}
				if (pinSignalName.length > 0 && pinSignalName.toLowerCase() !== pinPadNumber.toLowerCase()) {
					lookup.set(`${refDesLower}:${pinSignalName.toLowerCase()}`, info);
				}
			}
		}
		else if (netFlagName.length > 0) {
			// 网络标识符号（VCC、GND 等）：无引脚数据，以符号中心坐标作为连接点。
			// 同时注册 pinPadNumber='1' 和 pinSignalName=netFlagName 两种键，匹配 AI 的不同写法。
			const cx = sg<number>(rawComponent, 'getState_X', 0);
			const cy = sg<number>(rawComponent, 'getState_Y', 0);
			// 根据电源网络名推断引脚退出方向：GND 类从上方接入（90°），VCC 类从下方接入（270°）。
			const netNameLower = netFlagName.toLowerCase();
			let powerOrientDeg: number;
			if (/gnd|ground|earth|vss/.test(netNameLower)) {
				powerOrientDeg = 90;   // GND 引脚向上（Y 轴正方向）。
			} else if (/vcc|vdd|vbat|pwr|3v|5v|12v|1v/.test(netNameLower)) {
				powerOrientDeg = 270;  // VCC 引脚向下（Y 轴负方向）。
			} else {
				powerOrientDeg = 270;  // 未知电源符号默认向下。
			}

			const info: InternalPinInfo = {
				refDes: netFlagName,
				pinSignalName: netFlagName,
				pinPadNumber: '1',
				electricalType: 'power',
				hasNoConnectMark: false,
				wireConnectionX_mil: cx,
				wireConnectionY_mil: cy,
				orientationDeg: powerOrientDeg,
			};
			const nameLower = netFlagName.toLowerCase();
			lookup.set(`${nameLower}:1`, info);
			lookup.set(`${nameLower}:${nameLower}`, info);
		}
	}

	return lookup;
}

// 按 refDes + pin（信号名或编号）查找引脚信息。
function lookupPin(map: Map<string, InternalPinInfo>, refDes: string, pin: string): InternalPinInfo | undefined {
	const key = `${refDes.trim().toLowerCase()}:${pin.trim().toLowerCase()}`;
	return map.get(key);
}

// 解析并校验单条连接声明中的端点字段。
function parseConnectionDeclaration(raw: unknown, index: number): ConnectionDeclaration | { error: string } {
	if (!isPlainObjectRecord(raw)) {
		return { error: `connections[${String(index)}] 必须为对象。` };
	}

	if (!isPlainObjectRecord(raw.from)) {
		return { error: `connections[${String(index)}].from 必须为对象。` };
	}
	if (!isPlainObjectRecord(raw.to)) {
		return { error: `connections[${String(index)}].to 必须为对象。` };
	}

	const fromRefDes = String(raw.from.refDes ?? '').trim();
	const fromPin = String(raw.from.pin ?? '').trim();
	const toRefDes = String(raw.to.refDes ?? '').trim();
	const toPin = String(raw.to.pin ?? '').trim();
	const netName = String(raw.netName ?? '').trim();

	if (fromRefDes.length === 0 || fromPin.length === 0) {
		return { error: `connections[${String(index)}].from.refDes / .pin 不能为空。` };
	}
	if (toRefDes.length === 0 || toPin.length === 0) {
		return { error: `connections[${String(index)}].to.refDes / .pin 不能为空。` };
	}
	if (netName.length === 0) {
		return { error: `connections[${String(index)}].netName 不能为空。` };
	}

	return {
		from: { refDes: fromRefDes, pin: fromPin },
		to: { refDes: toRefDes, pin: toPin },
		netName,
	};
}

/**
 * 处理连线规划任务。
 * @param payload 任务参数，包含 connections 数组。
 * @returns 规划结果，校验通过时包含 planId 和连接摘要；校验失败时包含错误列表。
 */
export async function handleSchematicWirePlanTask(payload: unknown): Promise<unknown> {
	if (!isPlainObjectRecord(payload) || !Array.isArray(payload.connections)) {
		return { ok: false, error: 'schematic/wire/plan 任务缺少 connections 数组。' };
	}

	// 解析所有连接声明，提前捕获参数格式错误。
	const declarations: ConnectionDeclaration[] = [];
	for (let index = 0; index < payload.connections.length; index += 1) {
		const parsed = parseConnectionDeclaration(payload.connections[index], index);
		if ('error' in parsed) {
			return { ok: false, error: parsed.error };
		}
		declarations.push(parsed);
	}

	if (declarations.length === 0) {
		return { ok: false, error: 'connections 数组不能为空。' };
	}

	// 构建引脚查找表。
	const lookupResult = await buildPinLookup();
	if ('error' in lookupResult) {
		return { ok: false, error: lookupResult.error };
	}
	const pinLookup = lookupResult;

	// 跟踪每个引脚被分配到的网络，用于检测同一引脚出现在多个网络中的冲突。
	const pinNetAssignment = new Map<string, string>(); // key = "REFDES:PIN", value = netName

	const validationErrors: ValidationError[] = [];
	const resolvedConnections: WireConnection[] = [];

	for (let index = 0; index < declarations.length; index += 1) {
		const decl = declarations[index];
		const connKey = `connections[${String(index)}]`;

		const fromInfo = lookupPin(pinLookup, decl.from.refDes, decl.from.pin);
		if (!fromInfo) {
			validationErrors.push({
				index,
				code: 'ENDPOINT_NOT_FOUND',
				message: `${connKey}.from：在原理图中未找到器件 "${decl.from.refDes}" 的引脚 "${decl.from.pin}"。请检查位号和引脚名/编号是否正确。`,
			});
			continue;
		}

		const toInfo = lookupPin(pinLookup, decl.to.refDes, decl.to.pin);
		if (!toInfo) {
			validationErrors.push({
				index,
				code: 'ENDPOINT_NOT_FOUND',
				message: `${connKey}.to：在原理图中未找到器件 "${decl.to.refDes}" 的引脚 "${decl.to.pin}"。请检查位号和引脚名/编号是否正确。`,
			});
			continue;
		}

		// No Connect 引脚不允许参与连线。
		if (fromInfo.hasNoConnectMark) {
			validationErrors.push({
				index,
				code: 'NO_CONNECT_PIN',
				message: `${connKey}.from：器件 "${decl.from.refDes}" 的引脚 "${decl.from.pin}" 已标记 No Connect，不可参与连线。`,
			});
		}
		if (toInfo.hasNoConnectMark) {
			validationErrors.push({
				index,
				code: 'NO_CONNECT_PIN',
				message: `${connKey}.to：器件 "${decl.to.refDes}" 的引脚 "${decl.to.pin}" 已标记 No Connect，不可参与连线。`,
			});
		}

		// 检查同一引脚是否被分配到不同的网络（引脚冲突）。
		const fromPinKey = `${decl.from.refDes.toLowerCase()}:${decl.from.pin.toLowerCase()}`;
		const toPinKey = `${decl.to.refDes.toLowerCase()}:${decl.to.pin.toLowerCase()}`;

		const existingFromNet = pinNetAssignment.get(fromPinKey);
		if (existingFromNet !== undefined && existingFromNet !== decl.netName) {
			validationErrors.push({
				index,
				code: 'PIN_IN_MULTIPLE_NETS',
				message: `${connKey}.from：引脚 "${decl.from.refDes} ${decl.from.pin}" 在本规划中已被分配到网络 "${existingFromNet}"，与当前网络 "${decl.netName}" 冲突。`,
			});
		}
		const existingToNet = pinNetAssignment.get(toPinKey);
		if (existingToNet !== undefined && existingToNet !== decl.netName) {
			validationErrors.push({
				index,
				code: 'PIN_IN_MULTIPLE_NETS',
				message: `${connKey}.to：引脚 "${decl.to.refDes} ${decl.to.pin}" 在本规划中已被分配到网络 "${existingToNet}"，与当前网络 "${decl.netName}" 冲突。`,
			});
		}

		// 电源类型引脚互连短路检查：两个 power 类型引脚且信号名不同时，允许同名 power 引脚互连（如两个 VCC）。
		const fromPower = fromInfo.electricalType.toLowerCase() === 'power';
		const toPower = toInfo.electricalType.toLowerCase() === 'power';
		if (fromPower && toPower && fromInfo.pinSignalName.toLowerCase() !== toInfo.pinSignalName.toLowerCase()) {
			validationErrors.push({
				index,
				code: 'POWER_SHORT_CIRCUIT',
				message: `${connKey}：不能将两个不同信号的电源类型引脚直接连线（"${fromInfo.pinSignalName}" 与 "${toInfo.pinSignalName}"），这会造成电源短路。请使用正确的电源网络。`,
			});
		}

		// 记录引脚网络分配。
		pinNetAssignment.set(fromPinKey, decl.netName);
		pinNetAssignment.set(toPinKey, decl.netName);

		// 如果前述校验无错误，将此条连接加入已解析列表。
		if (validationErrors.filter(e => e.index === index).length === 0) {
			resolvedConnections.push({
				fromRefDes: fromInfo.refDes,
				fromPin: decl.from.pin,
				toRefDes: toInfo.refDes,
				toPin: decl.to.pin,
				netName: decl.netName,
				fromX_mil: fromInfo.wireConnectionX_mil,
				fromY_mil: fromInfo.wireConnectionY_mil,
				toX_mil: toInfo.wireConnectionX_mil,
				toY_mil: toInfo.wireConnectionY_mil,
				fromOrientationDeg: fromInfo.orientationDeg,
				toOrientationDeg: toInfo.orientationDeg,
			});
		}
	}

	// 如有任何校验错误，拒绝整个规划。
	if (validationErrors.length > 0) {
		return {
			ok: false,
			error: `连线规划校验失败，发现 ${String(validationErrors.length)} 个错误，整个规划已拒绝。请修正后重新提交。`,
			validationErrors,
		};
	}

	// 生成 planId 并存储（不将坐标返回给服务端/AI）。
	const planId = createWirePlan(resolvedConnections);

	// 构建返回给服务端的连接摘要（不含坐标）。
	const connectionSummaries = declarations.map((decl, index) => ({
		index,
		fromLabel: `${decl.from.refDes} 引脚 ${decl.from.pin}`,
		toLabel: `${decl.to.refDes} 引脚 ${decl.to.pin}`,
		netName: decl.netName,
	}));

	return {
		ok: true,
		planId,
		connectionCount: resolvedConnections.length,
		connections: connectionSummaries,
	};
}
