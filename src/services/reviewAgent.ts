import * as fs from 'fs';
import * as path from 'path';
import type { RecoveryFailureKind, RecoveryStage } from './llmRecoveryAgent';
import type { SrtEntry } from '../types';

export interface ReviewRecord {
    stage: RecoveryStage;
    chunkIndex: number;
    targetLang?: string;
    failure: RecoveryFailureKind;
    promptVariant: string;
    sourceTexts: string[];
    lineIndexes: number[];
    fallbackMode: string;
    reason: string;
    timestamp: string;
}

export interface LexiconCandidate {
    candidate: string;
    stage: RecoveryStage;
    targetLang?: string;
    chunkIndex: number;
    sourceSnippet: string;
    reason: string;
    status: 'pending';
    timestamp: string;
}

/**
 * ReviewAgent 只负责失败归因和审查工件输出。
 * 它不回写正式词典，也不介入主执行链路。
 */
export class ReviewAgent {
    recordFailure(
        outDir: string,
        input: {
            stage: RecoveryStage;
            chunkIndex: number;
            chunkEntries: SrtEntry[];
            sanitizedTexts: string[];
            failure: RecoveryFailureKind;
            promptVariant: string;
            fallbackMode: string;
            reason: string;
            targetLang?: string;
        }
    ): void {
        const timestamp = new Date().toISOString();
        const reviewRecord: ReviewRecord = {
            stage: input.stage,
            chunkIndex: input.chunkIndex,
            targetLang: input.targetLang,
            failure: input.failure,
            promptVariant: input.promptVariant,
            sourceTexts: input.sanitizedTexts,
            lineIndexes: input.chunkEntries.map((entry) => entry.index),
            fallbackMode: input.fallbackMode,
            reason: input.reason,
            timestamp,
        };

        this.appendJsonArray(path.join(outDir, 'manual-review.json'), reviewRecord);

        if (input.failure === 'refusal') {
            for (const candidate of this.extractCandidates(input)) {
                this.appendJsonArray(path.join(outDir, 'lexicon-candidates.json'), candidate);
            }
        }
    }

    private extractCandidates(input: {
        stage: RecoveryStage;
        chunkIndex: number;
        sanitizedTexts: string[];
        reason: string;
        targetLang?: string;
    }): LexiconCandidate[] {
        const timestamp = new Date().toISOString();
        const candidates: LexiconCandidate[] = [];
        const seen = new Set<string>();

        for (const text of input.sanitizedTexts) {
            for (const token of this.tokenize(text)) {
                if (seen.has(token)) {
                    continue;
                }
                seen.add(token);
                candidates.push({
                    candidate: token,
                    stage: input.stage,
                    targetLang: input.targetLang,
                    chunkIndex: input.chunkIndex,
                    sourceSnippet: text,
                    reason: input.reason,
                    status: 'pending',
                    timestamp,
                });
            }
        }

        return candidates;
    }

    private tokenize(text: string): string[] {
        return text
            .split(/[\s,.;:!?()[\]{}"']+/)
            .map((item) => item.trim())
            .filter((item) => item.length >= 2)
            .filter((item) => !/^__COMPLIANCE_\d+__$/.test(item))
            .slice(0, 8);
    }

    private appendJsonArray(filePath: string, record: unknown): void {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        let items: unknown[] = [];
        if (fs.existsSync(filePath)) {
            try {
                items = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (!Array.isArray(items)) {
                    items = [];
                }
            } catch {
                items = [];
            }
        }

        items.push(record);
        fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
    }
}
