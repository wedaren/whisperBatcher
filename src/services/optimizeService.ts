/**
 * OptimizeService：基于 LLM 的原始 SRT 可读性优化服务。
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
     * 读取原始 SRT，通过 LLM 优化文本并写出 *.llm.srt。
     * 返回优化后 SRT 的路径。
     *
     * 执行逻辑与原理（供维护者参考）
     * 1. 解析：读取 raw SRT 并用 `parseSrt` 转为条目数组，每个条目包含时间戳与文本。
     * 2. 分块：将条目按配置或默认的 `chunkSize`/`overlap` 分成多个块（chunk），
     *    每个块包含一个 core 区域和前后重叠区，用于保持上下文一致性并避免边界断裂。
     * 3. 合规化（sanitize）：对每行文本做合规替换（占位符替换敏感词），记录 restoreMap 与命中数（hits）。
     * 4. LLM 优化：将每个块的 sanitized 文本按行编号（[1] ...）拼成 prompt 发给 LLM，期望返回同样数量的行。
     *    - Prompt 要求仅输出编号行，不要额外注释；这有助于解析结果并保持行对齐。
     * 5. 解析与回退：解析 LLM 响应为行数组；若解析/匹配失败或被拒绝，则回退到 sanitized 文本（避免中断流水线），
     *    并将原始 prompt/response 写入 `llm-debug` 以便排查。
     * 6. 恢复占位符：将占位符恢复回原始敏感词，随后再做一次合规检查以保证最终输出合规。
     * 7. 泄露检测：检测是否有 prompt 内容被回显，若发生则写 debug 并中断（或按策略回退）。
     * 8. 写回：仅把块的核心区域（core）写回到最终的文本数组，最后用 `formatSrt` 写出 `*.llm.srt`。
     *
     * 维护与调优要点：
     * - 若遇到解析失败频繁，优先增强 `parseNumberedResponse`（支持更多编号格式）并启用更宽容的回退。
     * - 根据所用 LLM 的 token 限制调整 `chunkSize`，避免上下文截断。
     * - 若需更精确时间对齐，优化后可接入 forced-alignment（如 whisperx/gentle）微调时间戳。
     * - 所有异常/LLM 响应将写入 `llm-debug` 目录，便于离线分析与改进 prompt。
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

            // 合规化替换（sanitize）
            const sanitizedTexts: string[] = [];
            const restoreMaps: Array<{ idx: number; map: any[] }> = [];

            for (let j = 0; j < texts.length; j++) {
                const { sanitized, restoreMap, hits } = this.compliance.sanitize(texts[j]);
                sanitizedTexts.push(sanitized);
                restoreMaps.push({ idx: j, map: restoreMap });
                totalHits += hits;
            }

            // 构建发送给 LLM 的提示（prompt）
            const numberedLines = sanitizedTexts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n');
            let rawResponse = '';
            try {
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
                rawResponse = response.content || '';
            } catch (err) {
                this.writeOptimizeDebug(path.dirname(rawSrtPath), `optimize_chunk${i + 1}_error`, {
                    chunkIndex: i + 1,
                    chunkEntries: chunkEntries.map((e) => ({ index: e.index, startTime: e.startTime, endTime: e.endTime, text: e.text })),
                    sanitizedTexts: sanitizedTexts,
                    numberedPrompt: sanitizedTexts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n'),
                    llmError: String(err),
                });
                throw err;
            }

            // 解析 LLM 响应
            let resultTexts = this.parseNumberedResponse(rawResponse, sanitizedTexts.length);

            // 质量检查：块数量是否匹配
            if (resultTexts.length !== sanitizedTexts.length) {
                if (this.isRefusal(rawResponse)) {
                    log(`优化：块 ${i + 1}/${chunks.length} 因安全策略被 LLM 拒绝，回退到原始文本。`);
                    resultTexts = [...sanitizedTexts];
                } else {
                    throw new Error(
                        `Optimize chunk ${i + 1}: block count mismatch ` +
                        `(expected ${sanitizedTexts.length}, got ${resultTexts.length})`
                    );
                }
            }

            // 恢复占位符并检查合规性泄露
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

            // 提示词（prompt）泄露检测
            for (const t of restoredTexts) {
                if (this.containsPromptLeak(t)) {
                    this.writeOptimizeDebug(path.dirname(rawSrtPath), `optimize_chunk${i + 1}_promptleak`, {
                        chunkIndex: i + 1,
                        chunkEntries: chunkEntries.map((e) => ({ index: e.index, startTime: e.startTime, endTime: e.endTime, text: e.text })),
                        sanitizedTexts: sanitizedTexts,
                        numberedPrompt: sanitizedTexts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n'),
                        rawResponse: rawResponse,
                        leakedLine: t,
                    });

                    throw new Error(`LLM prompt leaked in optimize output at chunk ${i + 1}`);
                }
            }

            // 仅写回核心区域（避免覆盖重叠区的结果）
            const { chunkStart, coreStart, coreEnd } = chunkObj;
            for (let g = coreStart; g <= coreEnd; g++) {
                const localIdx = g - chunkStart;
                optimizedTexts[g] = restoredTexts[localIdx];
            }

            log(`优化：块 ${i + 1}/${chunks.length} 完成（合规命中 ${totalHits} 次）`);
        }

        // 将优化后的文本合并回条目（若缺失则回退到原始文本）
        const optimizedEntries: SrtEntry[] = entries.map((e, idx) => ({
            ...e,
            text: optimizedTexts[idx] ?? e.text,
        }));

        // 写出最终 SRT
        const dir = path.dirname(rawSrtPath);
        const baseName = path.basename(rawSrtPath).replace(/\.raw\.srt$/i, '');
        const llmSrtPath = path.join(dir, `${baseName}.llm.srt`);
        fs.writeFileSync(llmSrtPath, formatSrt(optimizedEntries), 'utf-8');

        return { llmSrtPath, complianceHits: totalHits };
    }

    private writeOptimizeDebug(outDir: string, prefix: string, data: any) {
        try {
            const debugDir = path.join(outDir, 'llm-debug');
            if (!fs.existsSync(debugDir)) { fs.mkdirSync(debugDir, { recursive: true }); }
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const base = path.join(debugDir, `${prefix}_${ts}`);
            fs.writeFileSync(`${base}.json`, JSON.stringify(data, null, 2), 'utf-8');
            if (data.numberedPrompt) {
                fs.writeFileSync(`${base}.prompt.txt`, data.numberedPrompt, 'utf-8');
            }
            if (data.rawResponse) {
                fs.writeFileSync(`${base}.response.txt`, data.rawResponse, 'utf-8');
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('写入 llm 调试转储失败', e);
        }
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

        // 回退：如果编号解析失败且行数与预期相同，则直接使用原始行
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
