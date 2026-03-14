/**
 * SRT 基础处理工具。
 * 负责解析、格式化、分块与文本提取，是优化和翻译流程的基础设施。
 */
import { SrtEntry } from '../types';

/**
 * 将 SRT 字幕文本解析为结构化条目。
 */
export function parseSrt(text: string): SrtEntry[] {
    const entries: SrtEntry[] = [];
    // 统一换行符，避免不同平台的换行格式影响解析。
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split(/\n\n+/).filter((b) => b.trim());

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) { continue; }

        const index = parseInt(lines[0], 10);
        if (isNaN(index)) { continue; }

        const timeParts = lines[1].split('-->');
        if (timeParts.length !== 2) { continue; }

        const startTime = timeParts[0].trim();
        const endTime = timeParts[1].trim();
        const text = lines.slice(2).join('\n');

        entries.push({ index, startTime, endTime, text });
    }

    return entries;
}

/**
 * 将结构化条目重新格式化回 SRT 文本。
 */
export function formatSrt(entries: SrtEntry[]): string {
    return entries
        .map((e, i) => {
            const idx = i + 1;
            return `${idx}\n${e.startTime} --> ${e.endTime}\n${e.text}`;
        })
        .join('\n\n') + '\n';
}

/**
 * 将字幕条目切分成多个块，供 LLM 分批处理。
 * overlap 用于保留相邻块上下文，coreStart/coreEnd 标记真正写回的核心区间。
 */
export function chunkSrtEntries(
    entries: SrtEntry[],
    chunkSize: number = 50,
    overlap: number = 0
): Array<{
    entries: SrtEntry[];
    chunkStart: number;
    coreStart: number;
    coreEnd: number;
}> {
    const n = entries.length;
    const chunks: Array<{
        entries: SrtEntry[];
        chunkStart: number;
        coreStart: number;
        coreEnd: number;
    }> = [];

    for (let coreStart = 0; coreStart < n; coreStart += chunkSize) {
        const coreEnd = Math.min(coreStart + chunkSize - 1, n - 1);
        const chunkStart = Math.max(0, coreStart - overlap);
        const chunkEnd = Math.min(n - 1, coreEnd + overlap);

        chunks.push({
            entries: entries.slice(chunkStart, chunkEnd + 1),
            chunkStart,
            coreStart,
            coreEnd,
        });
    }

    return chunks;
}

/**
 * 提取条目中的纯文本内容，并保留顺序映射。
 * 常用于将字幕正文发送给 LLM。
 */
export function extractTexts(entries: SrtEntry[]): string[] {
    return entries.map((e) => e.text);
}

/**
 * 将新文本合并回原字幕条目，同时保留时间轴。
 */
export function mergeTexts(entries: SrtEntry[], texts: string[]): SrtEntry[] {
    if (entries.length !== texts.length) {
        throw new Error(
            `Block count mismatch: expected ${entries.length}, got ${texts.length}`
        );
    }
    return entries.map((e, i) => ({
        ...e,
        text: texts[i],
    }));
}
