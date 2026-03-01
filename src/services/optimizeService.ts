/**
 * OptimizeService: LLM-based readability optimization of raw SRT.
 */
import * as fs from 'fs';
import * as path from 'path';
import { LLMClient } from './llmClient';
import { ComplianceService } from './complianceService';
import {
    parseSrt,
    formatSrt,
    chunkSrtEntries,
    extractTexts,
    mergeTexts,
} from './srtParser';
import { SrtEntry } from '../types';

export class OptimizeService {
    constructor(
        private llmClient: LLMClient,
        private compliance: ComplianceService
    ) { }

    /**
     * Read raw SRT, optimize text via LLM, write *.llm.srt.
     * Returns path to the optimized SRT.
     */
    async optimize(
        rawSrtPath: string,
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; chunkSize?: number; overlap?: number }
    ): Promise<{ llmSrtPath: string; complianceHits: number }> {
        const log = options?.logFn ?? (() => { });
        const rawText = fs.readFileSync(rawSrtPath, 'utf-8');
        const entries = parseSrt(rawText);

        if (entries.length === 0) {
            throw new Error('Raw SRT is empty or unparseable');
        }

        const chunks = chunkSrtEntries(entries, options?.chunkSize ?? 50, options?.overlap ?? 5);
        const optimizedTexts: Array<string | undefined> = new Array(entries.length).fill(undefined);
        let totalHits = 0;

        for (let i = 0; i < chunks.length; i++) {
            if (options?.signal?.aborted) { throw new Error('Aborted'); }

            const chunkObj = chunks[i];
            const chunkEntries = chunkObj.entries;
            const texts = extractTexts(chunkEntries);

            // Compliance sanitize
            const sanitizedTexts: string[] = [];
            const restoreMaps: Array<{ idx: number; map: any[] }> = [];

            for (let j = 0; j < texts.length; j++) {
                const { sanitized, restoreMap, hits } = this.compliance.sanitize(texts[j]);
                sanitizedTexts.push(sanitized);
                restoreMaps.push({ idx: j, map: restoreMap });
                totalHits += hits;
            }

            // Build LLM prompt
            const numberedLines = sanitizedTexts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n');
            const response = await this.llmClient.chat([
                {
                    role: 'system',
                    content:
                        'You are a subtitle editor. Optimize the following subtitle lines for readability. ' +
                        'Fix grammar, punctuation, and make text natural while preserving the original meaning. ' +
                        'Output ONLY the optimized lines, one per line, prefixed with their number like [1], [2], etc. ' +
                        'Keep the exact same number of lines. Do not add any explanations.',
                },
                { role: 'user', content: numberedLines },
            ], { signal: options?.signal });

            // Parse response
            const rawResponse = response.content || '';
            let resultTexts = this.parseNumberedResponse(rawResponse, sanitizedTexts.length);

            // Quality check: block count
            if (resultTexts.length !== sanitizedTexts.length) {
                if (this.isRefusal(rawResponse)) {
                    log(`Optimize: chunk ${i + 1}/${chunks.length} refused by LLM due to safety policy. Falling back to original text.`);
                    resultTexts = [...sanitizedTexts];
                } else {
                    throw new Error(
                        `Optimize chunk ${i + 1}: block count mismatch ` +
                        `(expected ${sanitizedTexts.length}, got ${resultTexts.length})`
                    );
                }
            }

            // Compliance restore + leakage check
            const restoredTexts = resultTexts.map((text, idx) => {
                const mapEntry = restoreMaps.find((m) => m.idx === idx);
                let restored = text;
                if (mapEntry && mapEntry.map.length > 0) {
                    restored = this.compliance.restore(text, mapEntry.map);
                }
                if (this.compliance.detectLeakage(restored)) {
                    throw new Error(`Compliance placeholder leaked in optimize chunk ${i + 1}, line ${idx + 1}`);
                }

                // Post-optimization compliance check
                const postSanitize = this.compliance.sanitize(restored);
                if (postSanitize.hits > 0) {
                    totalHits += postSanitize.hits;
                    restored = this.compliance.restore(postSanitize.sanitized, postSanitize.restoreMap);
                }

                return restored;
            });

            // Prompt leak detection
            for (const t of restoredTexts) {
                if (this.containsPromptLeak(t)) {
                    throw new Error(`LLM prompt leaked in optimize output at chunk ${i + 1}`);
                }
            }

            // Write back only the core region (avoid overwriting overlap results).
            const { chunkStart, coreStart, coreEnd } = chunkObj;
            for (let g = coreStart; g <= coreEnd; g++) {
                const localIdx = g - chunkStart;
                optimizedTexts[g] = restoredTexts[localIdx];
            }

            log(`Optimize: chunk ${i + 1}/${chunks.length} done (${totalHits} compliance hits)`);
        }

        // Merge optimized texts back into entries (fallback to original text when missing)
        const optimizedEntries: SrtEntry[] = entries.map((e, idx) => ({
            ...e,
            text: optimizedTexts[idx] ?? e.text,
        }));

        // Write output
        const dir = path.dirname(rawSrtPath);
        const baseName = path.basename(rawSrtPath).replace(/\.raw\.srt$/i, '');
        const llmSrtPath = path.join(dir, `${baseName}.llm.srt`);
        fs.writeFileSync(llmSrtPath, formatSrt(optimizedEntries), 'utf-8');

        return { llmSrtPath, complianceHits: totalHits };
    }

    private parseNumberedResponse(text: string, expectedCount: number): string[] {
        const lines = text.trim().split('\n').filter((l) => l.trim());
        const result: string[] = [];

        for (const line of lines) {
            const match = line.match(/^\[(\d+)\]\s*(.*)/);
            if (match) {
                result.push(match[2].trim());
            }
        }

        // Fallback: if numbered parsing didn't work, use raw lines
        if (result.length === 0 && lines.length === expectedCount) {
            return lines.map((l) => l.trim());
        }

        return result;
    }

    private containsPromptLeak(text: string): boolean {
        const leakPatterns = [
            /you are a subtitle/i,
            /optimize the following/i,
            /output only the/i,
            /do not add any explanation/i,
        ];
        return leakPatterns.some((p) => p.test(text));
    }

    private isRefusal(text: string): boolean {
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
}
