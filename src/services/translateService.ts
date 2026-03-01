/**
 * TranslateService: LLM-based subtitle translation to multiple target languages.
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

/** Map of language codes to human-readable names for prompts */
const LANG_NAMES: Record<string, string> = {
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'it': 'Italian',
    'ar': 'Arabic',
};

export class TranslateService {
    constructor(
        private llmClient: LLMClient,
        private compliance: ComplianceService
    ) { }

    /**
    * Translate optimized SRT into a single target language.
    * Returns path to *.<lang>.srt.
     */
    async translateToLanguage(
        llmSrtPath: string,
        targetLang: string,
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; outputDir?: string }
    ): Promise<{ translatedPath: string; complianceHits: number }> {
        const log = options?.logFn ?? (() => { });
        const srtText = fs.readFileSync(llmSrtPath, 'utf-8');
        const entries = parseSrt(srtText);

        if (entries.length === 0) {
            throw new Error('LLM SRT is empty or unparseable');
        }

        const langName = LANG_NAMES[targetLang] || targetLang;
        const chunks = chunkSrtEntries(entries, 20);
        const translatedEntries: SrtEntry[] = [];
        let totalHits = 0;
        const sourceTexts = extractTexts(entries);
        const skipSimilarityCheck = this.shouldSkipSimilarityCheck(targetLang, sourceTexts);
        const directPassThrough = this.shouldDirectPassThrough(targetLang, sourceTexts);

        if (skipSimilarityCheck) {
            log(`Translate [${targetLang}]: similarity guard skipped (source appears same language)`);
        }

        if (directPassThrough) {
            const outDir = options?.outputDir ?? path.dirname(llmSrtPath);
            if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
            const baseName = path.basename(llmSrtPath).replace(/\.llm\.srt$/i, '');
            const translatedPath = path.join(outDir, `${baseName}.${targetLang}.srt`);
            fs.writeFileSync(translatedPath, srtText, 'utf-8');
            log(`Translate [${targetLang}]: direct pass-through enabled (source appears English), skipped LLM translation`);
            return { translatedPath, complianceHits: 0 };
        }

        for (let i = 0; i < chunks.length; i++) {
            if (options?.signal?.aborted) { throw new Error('Aborted'); }

            const chunk = chunks[i];
            const texts = extractTexts(chunk);

            // Compliance sanitize
            const sanitizedTexts: string[] = [];
            const restoreMaps: Array<{ idx: number; map: any[] }> = [];

            for (let j = 0; j < texts.length; j++) {
                const { sanitized, restoreMap, hits } = this.compliance.sanitize(texts[j]);
                sanitizedTexts.push(sanitized);
                restoreMaps.push({ idx: j, map: restoreMap });
                totalHits += hits;
            }

            // Build translation prompt
            const numberedLines = sanitizedTexts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n');
            const response = await this.llmClient.chat([
                {
                    role: 'system',
                    content:
                        `You are a professional subtitle translator. Translate the following subtitle lines to ${langName}. ` +
                        'Output ONLY the translated lines, one per line, prefixed with their number like [1], [2], etc. ' +
                        'Keep the exact same number of lines. Preserve any placeholders (like __COMPLIANCE_N__) as-is. ' +
                        'Do not add explanations or notes.',
                },
                { role: 'user', content: numberedLines },
            ], { signal: options?.signal });
            const rawResponse = response.content || '';

            // Parse response
            let resultTexts = this.parseNumberedResponse(rawResponse, sanitizedTexts.length);
            log(
                `Translate [${targetLang}]: chunk ${i + 1}/${chunks.length} response chars=${rawResponse.length}, ` +
                `parsed=${resultTexts.length}/${sanitizedTexts.length}, preview="${this.previewText(rawResponse, 220)}"`
            );

            // Quality check: block count
            if (resultTexts.length !== sanitizedTexts.length) {
                const rawLines = rawResponse
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0)
                    .slice(0, 8)
                    .map((line, idx) => `[${idx + 1}] ${line}`)
                    .join(' | ');
                log(
                    `Translate [${targetLang}]: chunk ${i + 1}/${chunks.length} parse failed; ` +
                    `response first lines=${rawLines || '(empty)'}`
                );

                if (this.isRefusal(rawResponse)) {
                    log(`Translate [${targetLang}]: chunk ${i + 1}/${chunks.length} refused by LLM due to safety policy. Falling back to original text.`);
                    resultTexts = [...sanitizedTexts];
                } else {
                    throw new Error(
                        `Translate chunk ${i + 1} (${targetLang}): block count mismatch ` +
                        `(expected ${sanitizedTexts.length}, got ${resultTexts.length})`
                    );
                }
            }

            // Similarity check: if translation ≈ input, likely untranslated
            if (!skipSimilarityCheck) {
                const similarCount = resultTexts.filter(
                    (t, idx) => this.isSimilar(t, sanitizedTexts[idx])
                ).length;
                if (similarCount > sanitizedTexts.length * 0.8) {
                    throw new Error(
                        `Translate chunk ${i + 1} (${targetLang}): ` +
                        `output is suspiciously similar to input — likely untranslated`
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
                    throw new Error(`Compliance placeholder leaked in translate chunk ${i + 1}, line ${idx + 1}`);
                }

                // Post-translation compliance check (for target language rules)
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
                    throw new Error(`LLM prompt leaked in translate output at chunk ${i + 1}`);
                }
            }

            const merged = mergeTexts(chunk, restoredTexts);
            translatedEntries.push(...merged);

            log(`Translate [${targetLang}]: chunk ${i + 1}/${chunks.length} done`);
        }

        // Write output
        const outDir = options?.outputDir ?? path.dirname(llmSrtPath);
        if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
        const baseName = path.basename(llmSrtPath).replace(/\.llm\.srt$/i, '');
        const translatedPath = path.join(outDir, `${baseName}.${targetLang}.srt`);
        fs.writeFileSync(translatedPath, formatSrt(translatedEntries), 'utf-8');

        return { translatedPath, complianceHits: totalHits };
    }

    /**
     * Translate to all configured target languages.
     */
    async translateAll(
        llmSrtPath: string,
        targetLanguages: string[],
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; outputDir?: string }
    ): Promise<{ paths: Record<string, string>; totalComplianceHits: number }> {
        const paths: Record<string, string> = {};
        let totalHits = 0;

        for (const lang of targetLanguages) {
            if (options?.signal?.aborted) { throw new Error('Aborted'); }
            const result = await this.translateToLanguage(llmSrtPath, lang, options);
            paths[lang] = result.translatedPath;
            totalHits += result.complianceHits;
        }

        return { paths, totalComplianceHits: totalHits };
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

        if (result.length === 0 && lines.length === expectedCount) {
            return lines.map((l) => l.trim());
        }

        return result;
    }

    /**
     * Check if two strings are suspiciously similar (>90% character overlap).
     */
    private isSimilar(a: string, b: string): boolean {
        if (a === b) { return true; }
        const shorter = Math.min(a.length, b.length);
        const longer = Math.max(a.length, b.length);
        if (shorter === 0) { return longer === 0; }

        let matches = 0;
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        for (let i = 0; i < Math.min(aLower.length, bLower.length); i++) {
            if (aLower[i] === bLower[i]) { matches++; }
        }
        return matches / longer > 0.9;
    }

    private shouldSkipSimilarityCheck(targetLang: string, sourceTexts: string[]): boolean {
        const isEnglishTarget = /^en(?:-|$)/i.test(targetLang);
        if (!isEnglishTarget) {
            return false;
        }

        const source = sourceTexts.join(' ');
        const meaningfulChars = source.match(/\S/g)?.length ?? 0;
        if (meaningfulChars === 0) {
            return true;
        }

        const englishLikeChars = source.match(/[A-Za-z0-9\s.,!?;:'"()\-]/g)?.length ?? 0;
        return englishLikeChars / meaningfulChars > 0.7;
    }

    private shouldDirectPassThrough(targetLang: string, sourceTexts: string[]): boolean {
        return this.shouldSkipSimilarityCheck(targetLang, sourceTexts);
    }

    private containsPromptLeak(text: string): boolean {
        const leakPatterns = [
            /you are a.*translator/i,
            /translate the following/i,
            /output only the/i,
            /do not add explanation/i,
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

    private previewText(text: string, maxLen: number): string {
        if (!text) {
            return '';
        }
        const oneLine = text.replace(/\s+/g, ' ').trim();
        if (oneLine.length <= maxLen) {
            return oneLine;
        }
        return oneLine.slice(0, maxLen) + '...';
    }
}
