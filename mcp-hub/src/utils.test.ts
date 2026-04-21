import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	getExtensionRootPathFromRuntime,
	isPlainObjectRecord,
	parseBoundedIntegerValue,
	toSafeErrorMessage,
} from './utils';

describe('utils', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('isPlainObjectRecord', () => {
		it('accepts plain objects', () => {
			expect(isPlainObjectRecord({ key: 'value' })).toBe(true);
		});

		it('rejects null arrays and primitives', () => {
			expect(isPlainObjectRecord(null)).toBe(false);
			expect(isPlainObjectRecord(['a'])).toBe(false);
			expect(isPlainObjectRecord('text')).toBe(false);
		});
	});

	describe('toSafeErrorMessage', () => {
		it('uses error.message for Error instances', () => {
			expect(toSafeErrorMessage(new Error('boom'))).toBe('boom');
		});

		it('stringifies unknown values', () => {
			expect(toSafeErrorMessage(404)).toBe('404');
		});
	});

	describe('parseBoundedIntegerValue', () => {
		it('returns the provided integer when it is within range', () => {
			expect(parseBoundedIntegerValue(8, 3, 1, 10)).toBe(8);
		});

		it('falls back to the default value for non-integers', () => {
			expect(parseBoundedIntegerValue('8', 3, 1, 10)).toBe(3);
			expect(parseBoundedIntegerValue(2.5, 3, 1, 10)).toBe(3);
		});

		it('throws when the integer is outside the allowed range', () => {
			expect(() => parseBoundedIntegerValue(0, 3, 1, 10)).toThrow('整数参数超出范围，允许区间: 1-10。');
			expect(() => parseBoundedIntegerValue(11, 3, 1, 10)).toThrow('整数参数超出范围，允许区间: 1-10。');
		});
	});

	describe('getExtensionRootPathFromRuntime', () => {
		it('returns process.cwd when the runtime entry is missing', () => {
			const originalArgv = process.argv;
			const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('C:\\workspace\\mcp-hub');
			process.argv = ['node'];

			expect(getExtensionRootPathFromRuntime()).toBe('C:\\workspace\\mcp-hub');

			cwdSpy.mockRestore();
			process.argv = originalArgv;
		});

		it('resolves the extension root from the runtime entry path', () => {
			const runtimeEntryPath = path.join('C:\\workspace\\mcp-hub', 'out', 'server', 'index.js');
			const originalArgv = process.argv;
			process.argv = ['node', runtimeEntryPath];

			expect(getExtensionRootPathFromRuntime()).toBe(path.join('C:\\workspace\\mcp-hub'));

			process.argv = originalArgv;
		});
	});
});
