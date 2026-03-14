/**
 * SRT 解析工具单元测试。
 * 覆盖解析、格式化、分块和合并文本等基础行为。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkSrtEntries, extractTexts, formatSrt, mergeTexts, parseSrt } from '../../src/services/srtParser';

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

describe('srtParser', () => {
    it('should parse valid SRT content', () => {
        const entries = parseSrt(SAMPLE_SRT);
        assert.equal(entries.length, 3);
        assert.deepEqual(entries[0], {
            index: 1,
            startTime: '00:00:01,000',
            endTime: '00:00:04,000',
            text: 'Hello, world!',
        });
    });

    it('should format entries back into SRT', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const output = formatSrt(entries);
        const reparsed = parseSrt(output);
        assert.equal(reparsed.length, entries.length);
        assert.equal(reparsed[1].text, entries[1].text);
    });

    it('should split entries into chunks', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const chunks = chunkSrtEntries(entries, 2);
        assert.equal(chunks.length, 2);
        assert.equal(chunks[0].entries.length, 2);
        assert.equal(chunks[1].entries.length, 1);
    });

    it('should extract and merge texts', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const texts = extractTexts(entries);
        assert.deepEqual(texts, ['Hello, world!', 'This is a subtitle test.', 'Third line here.']);

        const merged = mergeTexts(entries, texts.map((item) => item.toUpperCase()));
        assert.equal(merged[0].text, 'HELLO, WORLD!');
        assert.equal(merged[0].startTime, '00:00:01,000');
    });

    it('should throw when merge text count does not match', () => {
        const entries = parseSrt(SAMPLE_SRT);
        assert.throws(() => mergeTexts(entries, ['only one']), /Block count mismatch/);
    });
});
