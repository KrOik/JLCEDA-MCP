import { describe, expect, it, vi } from 'vitest';

import {
	encodeAsciiToBase64,
	isPlainObjectRecord,
	parseBoundedIntegerValue,
	safeCall,
	toSafeErrorMessage,
	toSerializable,
	toSerializableAsync,
} from './utils';

describe('bridge utils', () => {
	it('recognizes plain object records only', () => {
		expect(isPlainObjectRecord({ foo: 'bar' })).toBe(true);
		expect(isPlainObjectRecord(Object.create(null) as Record<string, unknown>)).toBe(true);
		expect(isPlainObjectRecord(null)).toBe(false);
		expect(isPlainObjectRecord(['x'])).toBe(false);
		expect(isPlainObjectRecord('text')).toBe(false);
	});

	it('formats safe error messages', () => {
		expect(toSafeErrorMessage(new Error('bridge failed'))).toBe('bridge failed');
		expect(toSafeErrorMessage({ code: 500 })).toBe('[object Object]');
		expect(toSafeErrorMessage(404)).toBe('404');
	});

	it('parses bounded integers with defaults and range errors', () => {
		expect(parseBoundedIntegerValue(5, 20, 2, 20)).toBe(5);
		expect(parseBoundedIntegerValue('5', 20, 2, 20)).toBe(20);
		expect(parseBoundedIntegerValue(3.14, 20, 2, 20)).toBe(20);
		expect(() => parseBoundedIntegerValue(21, 20, 2, 20)).toThrow('整数参数超出范围');
		expect(() => parseBoundedIntegerValue(1, 20, 2, 20)).toThrow('整数参数超出范围');
	});

	it('encodes ASCII strings to base64', () => {
		expect(encodeAsciiToBase64('ABC')).toBe('QUJD');
		expect(encodeAsciiToBase64('AB')).toBe('QUI=');
		expect(encodeAsciiToBase64('')).toBe('');
	});

	it('serializes sync values with depth and circular guards', () => {
		const circular: { self?: unknown; nested?: unknown } = {
			nested: {
				level1: {
					level2: {
						level3: {
							level4: 'too-deep',
						},
					},
				},
			},
		};
		circular.self = circular;

		const serialized = toSerializable({
			name: 'bridge',
			count: 1n,
			when: new Date('2026-04-21T00:00:00.000Z'),
			runTask() {},
			circular,
		}) as Record<string, unknown>;

		expect(serialized).toMatchObject({
			name: 'bridge',
			count: '1',
			when: '2026-04-21T00:00:00.000Z',
			runTask: '[Function runTask]',
		});
		expect((serialized.circular as Record<string, unknown>).self).toBe('[Circular]');
		expect(
			(((serialized.circular as Record<string, unknown>).nested as Record<string, unknown>).level1 as Record<string, unknown>).level2,
		).toBe('[MaxDepthExceeded]');
	});

	it('serializes async blob-like payloads and arrays', async () => {
		const blob = new Blob(['hello'], { type: 'text/plain' }) as Blob & { name?: string; lastModified?: number };
		blob.name = 'bridge.txt';
		blob.lastModified = 1700000000000;

		const serialized = await toSerializableAsync({
			file: blob,
			items: [1, 2, 3],
		}) as Record<string, unknown>;

		expect(serialized.items).toEqual([1, 2, 3]);
		expect(serialized.file).toEqual({
			kind: 'blob',
			size: 5,
			type: 'text/plain',
			text: 'hello',
			name: 'bridge.txt',
			lastModified: 1700000000000,
		});
	});

	it('safeCall returns result on success and undefined on failure', async () => {
		const success = vi.fn(async () => 'ok');
		const failure = vi.fn(async () => {
			throw new Error('boom');
		});

		await expect(safeCall(success)).resolves.toBe('ok');
		await expect(safeCall(failure)).resolves.toBeUndefined();
		expect(success).toHaveBeenCalledTimes(1);
		expect(failure).toHaveBeenCalledTimes(1);
	});
});
