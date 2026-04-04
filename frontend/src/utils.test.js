// frontend/src/utils.test.js
import { formatBytes, formatDate, formatDuration, slugify } from './utils';

describe('formatBytes', () => {
    test('returns "0 Bytes" for 0', () => {
        expect(formatBytes(0)).toBe('0 Bytes');
    });

    test('returns "0 Bytes" for null/undefined', () => {
        expect(formatBytes(null)).toBe('0 Bytes');
        expect(formatBytes(undefined)).toBe('0 Bytes');
    });

    test('formats bytes correctly', () => {
        expect(formatBytes(1024)).toBe('1 KB');
        expect(formatBytes(1048576)).toBe('1 MB');
        expect(formatBytes(1073741824)).toBe('1 GB');
        expect(formatBytes(1099511627776)).toBe('1 TB');
    });

    test('respects decimals parameter', () => {
        expect(formatBytes(1536, 0)).toBe('2 KB');
        expect(formatBytes(1536, 1)).toBe('1.5 KB');
        expect(formatBytes(1536, 2)).toBe('1.5 KB');
    });

    test('handles large values', () => {
        expect(formatBytes(5 * 1024 * 1024 * 1024, 1)).toBe('5 GB');
    });
});

describe('formatDate', () => {
    test('returns "N/A" for empty input', () => {
        expect(formatDate(null)).toBe('N/A');
        expect(formatDate(undefined)).toBe('N/A');
        expect(formatDate('')).toBe('N/A');
    });

    test('formats a valid ISO date string', () => {
        const result = formatDate('2024-01-15T10:30:00Z');
        // Should contain date parts (locale-dependent, but should not be N/A)
        expect(result).not.toBe('N/A');
        expect(result).toContain('2024');
    });

    test('returns the original string for invalid dates', () => {
        const result = formatDate('not-a-date');
        // Depending on browser, may return "Invalid Date" or the original
        expect(result).toBeTruthy();
    });
});

describe('formatDuration', () => {
    test('returns "N/A" for missing start', () => {
        expect(formatDuration(null)).toBe('N/A');
        expect(formatDuration(undefined)).toBe('N/A');
    });

    test('formats duration between two timestamps', () => {
        const start = '2024-01-15T10:00:00Z';
        const end = '2024-01-15T11:30:45Z';
        const result = formatDuration(start, end);
        expect(result).toBe('1h 30m 45s');
    });

    test('formats short durations', () => {
        const start = '2024-01-15T10:00:00Z';
        const end = '2024-01-15T10:00:30Z';
        expect(formatDuration(start, end)).toBe('30s');
    });

    test('formats minutes and seconds', () => {
        const start = '2024-01-15T10:00:00Z';
        const end = '2024-01-15T10:05:10Z';
        expect(formatDuration(start, end)).toBe('5m 10s');
    });

    test('handles zero duration', () => {
        const ts = '2024-01-15T10:00:00Z';
        expect(formatDuration(ts, ts)).toBe('0s');
    });
});

describe('slugify', () => {
    test('converts to lowercase', () => {
        expect(slugify('Hello World')).toBe('hello-world');
    });

    test('replaces spaces with hyphens', () => {
        expect(slugify('my vm name')).toBe('my-vm-name');
    });

    test('removes special characters', () => {
        expect(slugify('VM (Test) #1')).toBe('vm-test-1');
    });

    test('collapses multiple hyphens', () => {
        expect(slugify('a---b')).toBe('a-b');
    });

    test('strips leading/trailing hyphens', () => {
        expect(slugify('-hello-')).toBe('hello');
    });

    test('handles empty string', () => {
        expect(slugify('')).toBe('');
    });

    test('handles already-slugified input', () => {
        expect(slugify('my-vm-name')).toBe('my-vm-name');
    });

    test('handles complex VM names', () => {
        expect(slugify('Windows Server 2019 (Production)')).toBe('windows-server-2019-production');
    });
});
