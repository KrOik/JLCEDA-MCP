import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	handleComponentPlaceCheckTask,
	handleComponentPlaceCloseTask,
	handleComponentPlaceStartTask,
	handleComponentPlaceTask,
} from './component-place-handler';

interface FollowMouseMessageApi {
	showFollowMouseTip: ReturnType<typeof vi.fn>;
	removeFollowMouseTip: ReturnType<typeof vi.fn>;
}

interface PrimitiveComponentApi {
	placeComponentWithMouse: ReturnType<typeof vi.fn>;
	getAllPrimitiveId: ReturnType<typeof vi.fn>;
}

function installEdaMocks(options?: {
	placeComponentWithMouse?: ReturnType<typeof vi.fn>;
	getAllPrimitiveId?: ReturnType<typeof vi.fn>;
	showFollowMouseTip?: ReturnType<typeof vi.fn>;
	removeFollowMouseTip?: ReturnType<typeof vi.fn>;
}): {
	primitiveApi: PrimitiveComponentApi;
	messageApi: FollowMouseMessageApi;
} {
	const primitiveApi: PrimitiveComponentApi = {
		placeComponentWithMouse: options?.placeComponentWithMouse ?? vi.fn().mockResolvedValue(true),
		getAllPrimitiveId: options?.getAllPrimitiveId ?? vi.fn().mockResolvedValue(['existing-1']),
	};
	const messageApi: FollowMouseMessageApi = {
		showFollowMouseTip: options?.showFollowMouseTip ?? vi.fn().mockResolvedValue(undefined),
		removeFollowMouseTip: options?.removeFollowMouseTip ?? vi.fn().mockResolvedValue(undefined),
	};

	(globalThis as typeof globalThis & { eda?: unknown }).eda = {
		sch_PrimitiveComponent: primitiveApi,
		sys_Message: messageApi,
	};

	return { primitiveApi, messageApi };
}

describe('component-place-handler', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		installEdaMocks();
	});

	it('validates the top-level payload and components array', async () => {
		await expect(handleComponentPlaceTask(null)).rejects.toThrow(TypeError);
		await expect(handleComponentPlaceTask({})).rejects.toThrow('缺少 components 参数，且其必须为数组。');
		await expect(handleComponentPlaceTask({ components: [] })).rejects.toThrow('components 不能为空');
		await expect(handleComponentPlaceTask({
			components: Array.from({ length: 51 }, () => ({ uuid: 'u', libraryUuid: 'l' })),
		})).rejects.toThrow('components 数量过多');
	});

	it('validates component identity and timeout boundaries', async () => {
		await expect(handleComponentPlaceTask({
			components: [{ libraryUuid: 'lib-1' }],
		})).rejects.toThrow('components[0].uuid 不能为空。');

		await expect(handleComponentPlaceTask({
			components: [{ uuid: 'u1', libraryUuid: 'lib-1' }],
			timeoutSeconds: 29,
		})).rejects.toThrow('timeoutSeconds 超出允许范围');
	});

	it('returns a normalized placement payload for valid requests', async () => {
		const result = await handleComponentPlaceTask({
			components: [
				{
					uuid: 'device-1',
					libraryUuid: 'lib-1',
					name: 'STM32F103',
					footprintName: 'LQFP-48',
					subPartName: 'A',
				},
			],
			timeoutSeconds: 60,
		}) as {
			ok: boolean;
			placement: {
				protocol: string;
				timeoutSeconds: number;
				retryCount: number;
				components: Array<Record<string, unknown>>;
			};
		};

		expect(result.ok).toBe(true);
		expect(result.placement).toMatchObject({
			protocol: 'component-place/v1',
			timeoutSeconds: 60,
			retryCount: 1,
		});
		expect(result.placement.components).toEqual([
			{
				uuid: 'device-1',
				libraryUuid: 'lib-1',
				name: 'STM32F103',
				footprintName: 'LQFP-48',
				subPartName: 'A',
			},
		]);
	});

	it('supports start/check/close task flow with mocked EDA primitives', async () => {
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();
		(globalThis as typeof globalThis & { document?: unknown }).document = {
			addEventListener,
			removeEventListener,
		};
		const { primitiveApi, messageApi } = installEdaMocks({
			getAllPrimitiveId: vi
				.fn()
				.mockResolvedValueOnce(['existing-1'])
				.mockResolvedValueOnce(['existing-1', 'new-2']),
		});

		const started = await handleComponentPlaceStartTask({
			component: {
				uuid: 'device-1',
				libraryUuid: 'lib-1',
				name: 'MCU',
				footprintName: 'LQFP-48',
				subPartName: '',
			},
			timeoutSeconds: 60,
		}) as { ok: boolean; sessionId?: string };

		expect(started.ok).toBe(true);
		expect(started.sessionId).toBeTypeOf('string');
		expect(primitiveApi.placeComponentWithMouse).toHaveBeenCalled();
		expect(messageApi.showFollowMouseTip).toHaveBeenCalled();
		expect(addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function), { capture: true });

		const checked = await handleComponentPlaceCheckTask({ sessionId: started.sessionId }) as Record<string, unknown>;
		expect(checked).toEqual({
			ok: true,
			placed: true,
			userCancelled: false,
		});

		await expect(handleComponentPlaceCloseTask({ sessionId: started.sessionId })).resolves.toEqual({ ok: true });
		expect(removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function), { capture: true });
		expect(messageApi.removeFollowMouseTip).toHaveBeenCalled();
	});

	it('returns a stable error when placeComponentWithMouse reports that binding failed', async () => {
		const { messageApi } = installEdaMocks({
			placeComponentWithMouse: vi.fn().mockResolvedValue(false),
		});

		await expect(handleComponentPlaceStartTask({
			component: {
				uuid: 'device-1',
				libraryUuid: 'lib-1',
			},
			timeoutSeconds: 60,
		})).resolves.toEqual({
			ok: false,
			error: 'placeComponentWithMouse 返回 false，交互放置会话未能启动。',
		});
		expect(messageApi.removeFollowMouseTip).toHaveBeenCalled();
	});

	it('marks the session as user-cancelled when the reference API flow receives a right-click cancel event', async () => {
		let mouseDownHandler: ((event: Event) => void) | undefined;
		const addEventListener = vi.fn((_eventName: string, handler: EventListenerOrEventListenerObject) => {
			mouseDownHandler = handler as (event: Event) => void;
		});
		const removeEventListener = vi.fn();
		const { messageApi } = installEdaMocks({
			getAllPrimitiveId: vi.fn().mockResolvedValue(['existing-1']),
		});
		(globalThis as typeof globalThis & { document?: unknown }).document = {
			addEventListener,
			removeEventListener,
		};

		const started = await handleComponentPlaceStartTask({
			component: {
				uuid: 'device-1',
				libraryUuid: 'lib-1',
			},
			timeoutSeconds: 60,
		}) as { ok: boolean; sessionId?: string };

		expect(started.ok).toBe(true);
		expect(mouseDownHandler).toBeTypeOf('function');
		mouseDownHandler?.({ button: 2 } as unknown as Event);

		await expect(handleComponentPlaceCheckTask({ sessionId: started.sessionId })).resolves.toEqual({
			ok: true,
			placed: false,
			userCancelled: true,
		});
		expect(messageApi.removeFollowMouseTip).toHaveBeenCalled();
		expect(removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function), { capture: true });
	});

	it('reports unknown placement sessions and malformed payloads', async () => {
		await expect(handleComponentPlaceCheckTask(null)).rejects.toThrow(TypeError);
		await expect(handleComponentPlaceCheckTask({})).rejects.toThrow('component/place/check 缺少 sessionId 参数。');
		await expect(handleComponentPlaceCloseTask({})).rejects.toThrow('component/place/close 缺少 sessionId 参数。');

		await expect(handleComponentPlaceCheckTask({ sessionId: 'missing-session' })).resolves.toEqual({
			ok: false,
			error: '未找到对应的器件放置会话。',
		});
	});
});
