/**
 * SRT subtitle parser & formatter
 */
import { SrtEntry } from '../types';

/**
 * Parse SRT subtitle text into structured entries.
 */
export function parseSrt(text: string): SrtEntry[] {
    const entries: SrtEntry[] = [];
    // Normalize line endings
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
 * Format SRT entries back into SRT text.
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
 * Chunk SRT entries into groups for batch LLM processing.
 * Returns array of SrtEntry arrays, each with at most `chunkSize` entries.
 */
export function chunkSrtEntries(entries: SrtEntry[], chunkSize: number = 20): SrtEntry[][] {
    const chunks: SrtEntry[][] = [];
    for (let i = 0; i < entries.length; i += chunkSize) {
        chunks.push(entries.slice(i, i + chunkSize));
    }
    return chunks;
}

/**
 * Extract just the text content from SRT entries, preserving index mapping.
 * Used to send text-only content to LLM.
 */
export function extractTexts(entries: SrtEntry[]): string[] {
    return entries.map((e) => e.text);
}

/**
 * Merge new text content back into SRT entries (preserving timecodes).
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
