/**
 * Shared LLM processing utilities used by OptimizeService and TranslateService.
 */
import * as fs from 'fs';
import * as path from 'path';
import { RestoreMap } from '../types';

/**
 * Parse a numbered LLM response (lines like "[1] text") into an array of strings.
 * Falls back to raw lines if no numbered format is found but line count matches.
 */
export function parseNumberedResponse(text: string, expectedCount: number): string[] {
    const lines = text.trim().split('\n').filter((l) => l.trim());
    const result: string[] = [];

    for (const line of lines) {
        const match = line.match(/^\[(\d+)\]\s*(.*)/);
        if (match) {
            result.push(match[2].trim());
        }
    }

    if (result.length === 0 && lines.length === expectedCount) {
        return lines.map((l) => l.trim());
    }

    return result;
}

/**
 * Detect whether the LLM response is a safety-policy refusal rather than real content.
 */
export function isRefusal(text: string): boolean {
    const lower = text.toLowerCase();
    return (
        lower.includes("sorry, i can't") ||
        lower.includes("sorry, i cannot") ||
        lower.includes("as an ai language model") ||
        lower.includes("i'm unable to") ||
        lower.includes("i am unable to") ||
        lower.includes("does not comply") ||
        lower.includes("violates") ||
        lower.includes("safety policy")
    );
}

/**
 * Write debug dump files (JSON + optional prompt/response text) into llm-debug directory.
 */
export function writeDebugDump(outDir: string, prefix: string, data: Record<string, unknown>): void {
    try {
        const debugDir = path.join(outDir, '.subtitle', 'llm-debug');
        if (!fs.existsSync(debugDir)) { fs.mkdirSync(debugDir, { recursive: true }); }
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const base = path.join(debugDir, `${prefix}_${ts}`);
        fs.writeFileSync(`${base}.json`, JSON.stringify(data, null, 2), 'utf-8');
        if (data.numberedPrompt) {
            fs.writeFileSync(`${base}.prompt.txt`, data.numberedPrompt as string, 'utf-8');
        }
        if (data.rawResponse) {
            fs.writeFileSync(`${base}.response.txt`, data.rawResponse as string, 'utf-8');
        }
    } catch (e) {
        console.error('写入 llm 调试转储失败', e);
    }
}

/**
 * Build a numbered prompt from an array of texts: "[1] text\n[2] text\n..."
 */
export function buildNumberedPrompt(texts: string[]): string {
    return texts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n');
}

/** Per-line sanitize result with typed RestoreMap */
export interface SanitizeEntry {
    idx: number;
    map: RestoreMap[];
}
