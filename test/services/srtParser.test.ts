/**
 * SRT 解析工具单元测试。
 * 覆盖解析、格式化、分块和合并文本等基础行为。
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
    it('应该能把合法 SRT 解析为条目数组', () => {
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

    it('应该兼容 Windows 换行符', () => {
        const winSrt = SAMPLE_SRT.replace(/\n/g, '\r\n');
        const entries = parseSrt(winSrt);
        expect(entries).toHaveLength(3);
    });

    it('空输入时应该返回空数组', () => {
        expect(parseSrt('')).toHaveLength(0);
    });

    it('应该跳过格式错误的字幕块', () => {
        const malformed = `not-a-number\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld`;
        const entries = parseSrt(malformed);
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('World');
    });
});

describe('formatSrt', () => {
    it('应该能把条目重新格式化为 SRT 文本', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const output = formatSrt(entries);
        // 重新解析格式化后的文本，应该得到等价条目。
        const reparsed = parseSrt(output);
        expect(reparsed).toHaveLength(entries.length);
        for (let i = 0; i < entries.length; i++) {
            expect(reparsed[i].startTime).toBe(entries[i].startTime);
            expect(reparsed[i].endTime).toBe(entries[i].endTime);
            expect(reparsed[i].text).toBe(entries[i].text);
        }
    });

    it('格式化时应该从 1 开始重新编号', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const output = formatSrt(entries);
        expect(output).toContain('1\n00:00:01,000');
    });
});

describe('chunkSrtEntries', () => {
    it('应该能按指定大小切分字幕块', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const chunks = chunkSrtEntries(entries, 2);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toHaveLength(2);
        expect(chunks[1]).toHaveLength(1);
    });

    it('如果条目数量足够小，应该只返回一个块', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const chunks = chunkSrtEntries(entries, 100);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toHaveLength(3);
    });
});

describe('extractTexts & mergeTexts', () => {
    it('应该能提取文本并正确合并回条目', () => {
        const entries = parseSrt(SAMPLE_SRT);
        const texts = extractTexts(entries);
        expect(texts).toEqual(['Hello, world!', 'This is a subtitle test.', 'Third line here.']);

        const modified = texts.map((t) => t.toUpperCase());
        const merged = mergeTexts(entries, modified);
        expect(merged[0].text).toBe('HELLO, WORLD!');
        expect(merged[0].startTime).toBe('00:00:01,000'); // 时间轴必须保持不变
    });

    it('文本数量不匹配时应该抛错', () => {
        const entries = parseSrt(SAMPLE_SRT);
        expect(() => mergeTexts(entries, ['only one'])).toThrow('Block count mismatch');
    });
});
