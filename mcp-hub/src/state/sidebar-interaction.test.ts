import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	clearSidebarInteractionRequest,
	clearSidebarInteractionResponse,
	getSidebarInteractionRequestFilePath,
	getSidebarInteractionResponseFilePath,
	readSidebarInteractionRequest,
	readSidebarInteractionResponse,
	writeSidebarInteractionRequest,
	writeSidebarInteractionResponse,
} from './sidebar-interaction';

function createTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'jlceda-mcp-sidebar-'));
}

describe('sidebar interaction state', () => {
	afterEach(() => {
		// nothing
	});

	it('sanitizes session ids in generated file paths', () => {
		const filePath = getSidebarInteractionRequestFilePath('C:\\tmp', 'session with / unsafe:*? chars');

		expect(path.basename(filePath)).toBe('jlceda-mcp-hub-sidebar-interaction-request-session_with_unsafe_chars.json');
	});

	it('round-trips a valid component-select interaction request', () => {
		const storageDir = createTempDir();
		const sessionId = 'session-select';
		const request = {
			kind: 'component-select' as const,
			requestId: 'req-1',
			keyword: 'STM32',
			title: '器件选型',
			description: '请选择器件',
			noticeText: '',
			candidates: [
				{
					uuid: 'device-1',
					libraryUuid: 'lib-1',
					name: 'STM32F103',
					symbolName: 'STM32',
					footprintName: 'LQFP-48',
					description: 'MCU',
					manufacturer: 'ST',
					manufacturerId: 'st',
					supplier: 'LCSC',
					supplierId: 'c1',
					lcscInventory: 100,
					lcscPrice: 5.2,
				},
			],
			pageSize: 20,
			currentPage: 1,
			timeoutSeconds: 60,
		};

		writeSidebarInteractionRequest(storageDir, sessionId, request);
		expect(readSidebarInteractionRequest(storageDir, sessionId)).toEqual(request);

		clearSidebarInteractionRequest(storageDir, sessionId);
		expect(readSidebarInteractionRequest(storageDir, sessionId)).toBeUndefined();
	});

	it('round-trips valid response payloads and rejects invalid ones', () => {
		const storageDir = createTempDir();
		const sessionId = 'session-response';
		const response = {
			requestId: 'req-2',
			action: 'confirm-selection' as const,
			candidate: {
				uuid: 'device-1',
				libraryUuid: 'lib-1',
				name: 'STM32F103',
				symbolName: 'STM32',
				footprintName: 'LQFP-48',
				description: 'MCU',
				manufacturer: 'ST',
				manufacturerId: 'st',
				supplier: 'LCSC',
				supplierId: 'c1',
				lcscInventory: 100,
				lcscPrice: 5.2,
			},
		};

		writeSidebarInteractionResponse(storageDir, sessionId, response);
		expect(readSidebarInteractionResponse(storageDir, sessionId)).toEqual(response);

		fs.writeFileSync(
			getSidebarInteractionResponseFilePath(storageDir, sessionId),
			JSON.stringify({ requestId: 'req-2', action: 'change-page', page: 0 }, null, 2),
			'utf8',
		);
		expect(readSidebarInteractionResponse(storageDir, sessionId)).toBeUndefined();

		clearSidebarInteractionResponse(storageDir, sessionId);
		expect(readSidebarInteractionResponse(storageDir, sessionId)).toBeUndefined();
	});

	it('rejects malformed request payloads from disk', () => {
		const storageDir = createTempDir();
		const sessionId = 'session-invalid-request';

		fs.writeFileSync(
			getSidebarInteractionRequestFilePath(storageDir, sessionId),
			JSON.stringify({
				kind: 'component-place',
				requestId: 'req-3',
				title: '原理图器件放置',
				description: 'bad',
				noticeText: '',
				totalCount: 1,
				placedCount: 0,
				statusText: '等待',
				timeoutSeconds: 60,
				retryCount: 1,
				started: false,
				canStart: true,
				canCancel: true,
				rows: [
					{
						title: '1. MCU',
						detail: '封装：LQFP-48',
						status: 'unknown',
						statusText: 'bad',
					},
				],
			}, null, 2),
			'utf8',
		);

		expect(readSidebarInteractionRequest(storageDir, sessionId)).toBeUndefined();
	});
});
