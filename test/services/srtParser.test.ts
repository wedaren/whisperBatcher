/**
 * SRT Parser unit tests
 */
import { parseSrt, formatSrt, chunkSrtEntries, extractTexts, mergeTexts } from '../../src/services/srtParser';

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
Hello, world!

2
00:00:05,000 --> 00:00:08,000
This is a subtitle test.

3
00:00:09,000 --> 00:00:12,000
Third line here.
`;

describe('parseSrt', () => {
    it('should parse valid SRT text into entries', () => {
        const entries = parseSrt(SAMPLE_SRT);
        expect(entries).toHaveLength(3);
        expect(entries[0]).toEqual({
            index: 1,
            startTime: '00:00:01,000',
            endTime: '00:00:04,000',
            text: 'Hello, world!',
        });
        expect(entries[2].text).toBe('Third line here.');
    });

    it('should handle Windows line endings', () => {
        const winSrt = SAMPLE_SRT.replace(/\n/g, '\r\n');
        const entries = parseSrt(winSrt);
        expect(entries).toHaveLength(3);
    });

    it('should return empty array for empty input', () => {
        expect(parseSrt('')).toHaveLength(0);
    });

    it('should skip malformed blocks', () => {
        const malformed = `not-a-number\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld`;
        const entries = parseSrt(malformed);
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('World');
    });
});

describe('formatSrt', () => {
    it('should format entries back to SRT text', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const output = formatSrt(entries);
        // Re-parse should yield same entries
        const reparsed = parseSrt(output);
        expect(reparsed).toHaveLength(entries.length);
        for (let i = 0; i < entries.length; i++) {
            expect(reparsed[i].startTime).toBe(entries[i].startTime);
            expect(reparsed[i].endTime).toBe(entries[i].endTime);
            expect(reparsed[i].text).toBe(entries[i].text);
        }
    });

    it('should re-index entries starting from 1', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const output = formatSrt(entries);
        expect(output).toContain('1\n00:00:01,000');
    });
});

describe('chunkSrtEntries', () => {
    it('should split entries into chunks of given size', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const chunks = chunkSrtEntries(entries, 2);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toHaveLength(2);
        expect(chunks[1]).toHaveLength(1);
    });

    it('should return single chunk if entries fit', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const chunks = chunkSrtEntries(entries, 100);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toHaveLength(3);
    });
});

describe('extractTexts & mergeTexts', () => {
    it('should extract texts and merge back correctly', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const texts = extractTexts(entries);
        expect(texts).toEqual(['Hello, world!', 'This is a subtitle test.', 'Third line here.']);

        const modified = texts.map((t) => t.toUpperCase());
        const merged = mergeTexts(entries, modified);
        expect(merged[0].text).toBe('HELLO, WORLD!');
        expect(merged[0].startTime).toBe('00:00:01,000'); // timecodes preserved
    });

    it('should throw on count mismatch', () => {
        const entries = parseSrt(SAMPLE_SRT);
        expect(() => mergeTexts(entries, ['only one'])).toThrow('Block count mismatch');
    });
});
