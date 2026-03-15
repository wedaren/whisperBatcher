/**
 * 翻译服务：基于 LLM 将优化后的字幕翻译成多个目标语言。
 *
 * 错误处理设计意图：TranslateService 在遇到错误时静默回退到 sanitized 原文。
 * 这是有意为之——单个坏块不应导致整个翻译丢失。对于翻译而言，
 * 保留原文（即使未翻译）比完全中断流水线更好。
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
} from './srtParser';
import { SrtEntry } from '../types';
import { TRANSLATE_CHUNK_SIZE, TRANSLATE_OVERLAP, SIMILARITY_THRESHOLD, UNTRANSLATED_LINE_RATIO, ENGLISH_DETECTION_RATIO, LANG_NAMES } from '../constants';
import { parseNumberedResponse, isRefusal, writeDebugDump, buildNumberedPrompt, SanitizeEntry } from './llmUtils';
import { LlmRecoveryAgent, type PromptVariant, type RecoveryFailureKind } from './llmRecoveryAgent';
import { ReviewAgent } from './reviewAgent';

export class TranslateService {
    constructor(
        private llmClient: LLMClient,
        private compliance: ComplianceService,
        private recoveryAgent: LlmRecoveryAgent = new LlmRecoveryAgent(),
        private reviewAgent: ReviewAgent = new ReviewAgent()
    ) { }

    /**
    * 将优化后的 SRT 翻译为单个目标语言。
    * 返回生成后的 `*.<lang>.srt` 路径。
     */
    async translateToLanguage(
        llmSrtPath: string,
        targetLang: string,
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; outputDir?: string; chunkSize?: number; overlap?: number }
    ): Promise<{ translatedPath: string; complianceHits: number }> {
        const log = options?.logFn ?? (() => { });
        const srtText = fs.readFileSync(llmSrtPath, 'utf-8');
        const entries = parseSrt(srtText);
        /**
         * 翻译流程（维护者说明）
         * 1. 解析：读取 LLM 优化后的 SRT 并用 `parseSrt` 转为条目数组，每个条目包含时间戳与文本。
         * 2. 分块（chunk）：将条目按配置或默认的 `chunkSize` / `overlap` 分成多个块；
         *    每个块包含：
         *      - chunk 范围（chunkStart..chunkEnd）
         *      - core 区域（coreStart..coreEnd）为该块的"核心"部分
         *      - 前后重叠区用于保持上下文一致性并避免边界断裂
         *    这样可以在保持上下文的同时只把核心区域的翻译结果合并回最终输出，
         *    避免重叠区域被不同块的结果覆盖产生不一致。
         * 3. 合规化（sanitize）：对每行文本做合规替换（占位符替换敏感词），记录 restoreMap 与命中数（hits）。
         * 4. LLM 翻译：将块内的 sanitized 文本按行编号（[1] ...）拼成 prompt 发给 LLM，期望返回同样数量的行；
         *    - Prompt 要求仅输出编号行，不要额外注释；以保持行对齐便于解析。
         * 5. 解析与回退：解析 LLM 响应为行数组；若解析/匹配失败或被拒绝，则回退到 sanitized 文本并写 debug。
         * 6. 恢复占位符与合规检测：将占位符恢复回原始敏感词，检测是否有占位符泄露并做 post-sanitize。
         * 7. 提示词泄露检测：检查翻译结果中是否包含 prompt 内容（如"translate the following"），若发现用回退策略处理并写 debug。
         * 8. 写回：把块的核心区域（core）合并进最终条目数组，最后用 `formatSrt` 写出 `*.<lang>.srt`。
         *
         * 维护与调优要点：
         * - 根据所用 LLM 的 token 限制调整 `chunkSize`，避免上下文截断。
         * - 若遇到解析失败频繁，可增强 parseNumberedResponse 的容错并采用更宽容的回退策略。
         */
        if (entries.length === 0) {
            throw new Error('LLM SRT is empty or unparseable');
        }

        const langName = LANG_NAMES[targetLang] || targetLang;
        const chunks = chunkSrtEntries(entries, options?.chunkSize ?? TRANSLATE_CHUNK_SIZE, options?.overlap ?? TRANSLATE_OVERLAP);
        // translatedTexts 保存全局每一条的翻译结果（仅填充 core 区域），最后与原条目合并
        const translatedTexts: Array<string | undefined> = new Array(entries.length).fill(undefined);
        let totalHits = 0;
        const sourceTexts = extractTexts(entries);
        const skipSimilarityCheck = this.shouldSkipSimilarityCheck(targetLang, sourceTexts);
        const directPassThrough = this.shouldDirectPassThrough(targetLang, sourceTexts);

        if (skipSimilarityCheck) {
            log(`Translate [${targetLang}]: 已跳过相似性检测（源文本疑似为目标语言）`);
        }

        if (directPassThrough) {
            const outDir = options?.outputDir ?? path.dirname(llmSrtPath);
            if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
            const baseName = path.basename(llmSrtPath).replace(/\.llm\.srt$/i, '');
            const translatedPath = path.join(outDir, `${baseName}.${targetLang}.srt`);
            fs.writeFileSync(translatedPath, srtText, 'utf-8');
            log(`Translate [${targetLang}]: 已启用直接透传（源文本疑似为英文），已跳过 LLM 翻译`);
            return { translatedPath, complianceHits: 0 };
        }

        for (let i = 0; i < chunks.length; i++) {
            if (options?.signal?.aborted) { throw new Error('Aborted'); }

            const chunkObj = chunks[i];
            const chunkEntries = chunkObj.entries;
            const texts = extractTexts(chunkEntries);

            // 合规替换：先将敏感词替换成占位符后再发给 LLM。
            const sanitizedTexts: string[] = [];
            const restoreMaps: SanitizeEntry[] = [];
            let chunkHits = 0; // 本块的合规命中计数

            for (let j = 0; j < texts.length; j++) {
                const { sanitized, restoreMap, hits } = this.compliance.sanitize(texts[j]);
                sanitizedTexts.push(sanitized);
                restoreMaps.push({ idx: j, map: restoreMap });
                totalHits += hits;
                chunkHits += hits;
            }

            let resultTexts = [...sanitizedTexts];
            let rawResponse = '';
            let currentChunkSize = sanitizedTexts.length;
            let promptVariant: PromptVariant = 'standard';
            const failures: RecoveryFailureKind[] = [];

            for (let attempt = 0; ; attempt++) {
                const numberedLines = buildNumberedPrompt(sanitizedTexts);
                try {
                    const response = await this.llmClient.chat([
                        {
                            role: 'system',
                            content: this.buildTranslateSystemPrompt(langName, promptVariant),
                        },
                        { role: 'user', content: numberedLines },
                    ], { signal: options?.signal });
                    rawResponse = response.content || '';
                } catch (err) {
                    const failure = 'call_error' as const;
                    failures.push(failure);
                    writeDebugDump(options?.outputDir ?? path.dirname(llmSrtPath), `translate_${targetLang}_chunk${i + 1}`, {
                        chunkIndex: i + 1,
                        chunkEntries: chunkEntries.map((e) => ({ index: e.index, startTime: e.startTime, endTime: e.endTime, text: e.text })),
                        sanitizedTexts,
                        numberedPrompt: numberedLines,
                        llmError: String(err),
                        promptVariant,
                        attempt,
                    });
                    const decision = this.recoveryAgent.decide('translate', { attempt, chunkSize: currentChunkSize, promptVariant, failures }, failure);
                    log(`Translate [${targetLang}]: 块 ${i + 1}/${chunks.length} LLM 调用失败，恢复策略=${decision.reason}`);
                    if (!decision.shouldRetry) {
                        break;
                    }
                    promptVariant = decision.nextPromptVariant;
                    currentChunkSize = decision.nextChunkSize;
                    continue;
                }

                resultTexts = parseNumberedResponse(rawResponse, sanitizedTexts.length);
                log(`Translate [${targetLang}]: 块 ${i + 1}/${chunks.length} 尝试 ${attempt + 1}，响应长度=${rawResponse.length} 字符，解析=${resultTexts.length}/${sanitizedTexts.length}，prompt=${promptVariant}`);

                let failure: RecoveryFailureKind | undefined;
                if (resultTexts.length !== sanitizedTexts.length) {
                    failure = isRefusal(rawResponse) ? 'refusal' : 'parse_mismatch';
                } else if (!skipSimilarityCheck) {
                    const similarCount = resultTexts.filter((t, idx) => this.isSimilar(t, sanitizedTexts[idx])).length;
                    if (similarCount > sanitizedTexts.length * UNTRANSLATED_LINE_RATIO) {
                        failure = 'untranslated';
                        writeDebugDump(options?.outputDir ?? path.dirname(llmSrtPath), `translate_${targetLang}_chunk${i + 1}_similar`, {
                            chunkIndex: i + 1,
                            chunkEntries: chunkEntries.map((e) => ({ index: e.index, startTime: e.startTime, endTime: e.endTime, text: e.text })),
                            sanitizedTexts,
                            numberedPrompt: numberedLines,
                            rawResponse,
                            similarCount,
                            total: sanitizedTexts.length,
                            promptVariant,
                            attempt,
                        });
                    }
                }

                if (!failure) {
                    break;
                }

                failures.push(failure);
                if (failure !== 'refusal') {
                    writeDebugDump(options?.outputDir ?? path.dirname(llmSrtPath), `translate_${targetLang}_chunk${i + 1}_${failure}`, {
                        chunkIndex: i + 1,
                        chunkEntries: chunkEntries.map((e) => ({ index: e.index, startTime: e.startTime, endTime: e.endTime, text: e.text })),
                        sanitizedTexts,
                        numberedPrompt: numberedLines,
                        rawResponse,
                        parsedCount: resultTexts.length,
                        expectedCount: sanitizedTexts.length,
                        promptVariant,
                        attempt,
                    });
                }
                const decision = this.recoveryAgent.decide('translate', { attempt, chunkSize: currentChunkSize, promptVariant, failures }, failure);
                log(`Translate [${targetLang}]: 块 ${i + 1}/${chunks.length} 检测到 ${failure}，恢复策略=${decision.reason}`);
                if (!decision.shouldRetry) {
                    this.reviewAgent.recordFailure(options?.outputDir ?? path.dirname(llmSrtPath), {
                        stage: 'translate',
                        chunkIndex: i + 1,
                        chunkEntries,
                        sanitizedTexts,
                        failure,
                        promptVariant,
                        fallbackMode: decision.fallbackMode,
                        reason: decision.reason,
                        targetLang,
                    });
                    resultTexts = [...sanitizedTexts];
                    break;
                }
                promptVariant = decision.nextPromptVariant;
                currentChunkSize = decision.nextChunkSize;
            }

            // 恢复占位符，并检查是否有占位符泄露。
            const restoredTexts = resultTexts.map((text, idx) => {
                const mapEntry = restoreMaps.find((m) => m.idx === idx);
                let restored = text;
                if (mapEntry && mapEntry.map.length > 0) {
                    try {
                        restored = this.compliance.restore(text, mapEntry.map);
                    } catch (e) {
                        // 恢复失败时退回到 sanitize 原文。
                        writeDebugDump(options?.outputDir ?? path.dirname(llmSrtPath), `translate_${targetLang}_chunk${i + 1}_restorefail`, {
                            chunkIndex: i + 1,
                            idx,
                            error: String(e),
                        });
                        restored = sanitizedTexts[idx];
                    }
                }
                if (this.compliance.detectLeakage(restored)) {
                    writeDebugDump(options?.outputDir ?? path.dirname(llmSrtPath), `translate_${targetLang}_chunk${i + 1}_leak`, { chunkIndex: i + 1, idx, restored });
                    restored = sanitizedTexts[idx];
                }

                // 翻译完成后再做一次合规检查，避免目标语言里重新出现敏感词。
                const postSanitize = this.compliance.sanitize(restored);
                if (postSanitize.hits > 0) {
                    totalHits += postSanitize.hits;
                    chunkHits += postSanitize.hits;
                    restored = this.compliance.restore(postSanitize.sanitized, postSanitize.restoreMap);
                }

                return restored;
            });

            // 提示词泄露检测：发现 prompt 内容混入输出时，替换为回退文本。
            for (let k = 0; k < restoredTexts.length; k++) {
                const t = restoredTexts[k];
                if (this.containsPromptLeak(t)) {
                    writeDebugDump(options?.outputDir ?? path.dirname(llmSrtPath), `translate_${targetLang}_chunk${i + 1}_promptleak`, {
                        chunkIndex: i + 1,
                        idx: k,
                        chunkEntries: chunkEntries.map((e) => ({ index: e.index, startTime: e.startTime, endTime: e.endTime, text: e.text })),
                        sanitizedTexts: sanitizedTexts,
                        numberedPrompt: buildNumberedPrompt(sanitizedTexts),
                        rawResponse,
                        leakedLine: t,
                    });

                    log(`Translate [${targetLang}]: 块 ${i + 1} 检测到提示词泄露，第 ${k + 1} 行；使用已 sanitize 的回退。`);
                    restoredTexts[k] = sanitizedTexts[k];
                }
            }

            // 仅写回该 chunk 的 core 区域，避免重叠区被后续 chunk 覆盖
            const { chunkStart, coreStart, coreEnd } = chunkObj;
            for (let g = coreStart; g <= coreEnd; g++) {
                const localIdx = g - chunkStart;
                translatedTexts[g] = restoredTexts[localIdx];
            }

            log(`Translate [${targetLang}]: 块 ${i + 1}/${chunks.length} 完成（合规命中 ${chunkHits} 次）`);
        }

        // 将翻译结果合并回条目（若缺失则回退到原始文本）
        const finalEntries: SrtEntry[] = entries.map((e, idx) => ({
            ...e,
            text: translatedTexts[idx] ?? e.text,
        }));

        return this.finalizeTranslateOutput(llmSrtPath, targetLang, finalEntries, totalHits, options);
    }

    /**
     * 翻译到所有目标语言。
     */
    async translateAll(
        llmSrtPath: string,
        targetLanguages: string[],
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; outputDir?: string; chunkSize?: number; overlap?: number }
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

    /**
     * 判断两段文本是否可疑地过于相似。
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
        return matches / longer > SIMILARITY_THRESHOLD;
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
        return englishLikeChars / meaningfulChars > ENGLISH_DETECTION_RATIO;
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

    private buildTranslateSystemPrompt(langName: string, variant: PromptVariant): string {
        if (variant === 'reduced_risk') {
            return `You translate subtitle lines into ${langName}. Return only numbered translated lines like [1], [2]. Keep placeholders such as __COMPLIANCE_N__ unchanged. Do not add explanations, comments, or unsafe elaboration.`;
        }
        if (variant === 'strict_format') {
            return `Translate each subtitle line to ${langName}. Output exactly one numbered line for each input line, preserving numbering and placeholders. No extra text.`;
        }
        return `You are a professional subtitle translator. Translate the following subtitle lines to ${langName}. Output ONLY the translated lines, one per line, prefixed with their number like [1], [2], etc. Keep the exact same number of lines. Preserve any placeholders (like __COMPLIANCE_N__) as-is. Do not add explanations or notes.`;
    }

    private finalizeTranslateOutput(llmSrtPath: string, targetLang: string, translatedEntries: SrtEntry[], totalHits: number, options?: { outputDir?: string }) {
        const outDir = options?.outputDir ?? path.dirname(llmSrtPath);
        if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }
        const baseName = path.basename(llmSrtPath).replace(/\.llm\.srt$/i, '');
        const translatedPath = path.join(outDir, `${baseName}.${targetLang}.srt`);
        fs.writeFileSync(translatedPath, formatSrt(translatedEntries), 'utf-8');
        return { translatedPath, complianceHits: totalHits };
    }
}
