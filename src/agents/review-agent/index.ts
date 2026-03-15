import * as fs from 'fs';
import * as path from 'path';
import type { RecoveryFailureKind, RecoveryStage } from '../execution-agent';
import type { SrtEntry } from '../../types';
export * from './manifest';

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

export interface ReviewFailureInput {
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

/**
 * ReviewAgent 只负责失败归因和工件输出。
 * 它不回写正式词典，也不参与主链路重试。
 */
export class ReviewAgent {
    recordFailure(outDir: string, input: ReviewFailureInput): void {
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

        const reviewFile = path.join(outDir, 'manual-review.json');
        this.appendJsonArray(reviewFile, reviewRecord);

        if (input.failure === 'refusal') {
            const candidateFile = path.join(outDir, 'lexicon-candidates.json');
            for (const candidate of this.extractCandidates(input)) {
                this.appendJsonArray(candidateFile, candidate);
            }
        }

        this.writeRecoverySummary(outDir);
    }

    private extractCandidates(input: Pick<ReviewFailureInput, 'stage' | 'chunkIndex' | 'sanitizedTexts' | 'reason' | 'targetLang'>): LexiconCandidate[] {
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

    private writeRecoverySummary(outDir: string): void {
        const reviewPath = path.join(outDir, 'manual-review.json');
        const candidatePath = path.join(outDir, 'lexicon-candidates.json');
        const summaryPath = path.join(outDir, 'recovery-summary.md');

        const reviews = this.readJsonArray<ReviewRecord>(reviewPath);
        const candidates = this.readJsonArray<LexiconCandidate>(candidatePath);

        const lines: string[] = [
            '# Recovery Summary',
            '',
            `- 失败块总数：${reviews.length}`,
            `- 词典候选总数：${candidates.length}`,
        ];

        if (reviews.length > 0) {
            const grouped = new Map<string, number>();
            for (const review of reviews) {
                const key = `${review.stage}:${review.failure}`;
                grouped.set(key, (grouped.get(key) ?? 0) + 1);
            }
            lines.push('', '## Failure Buckets', '');
            for (const [key, count] of grouped.entries()) {
                lines.push(`- ${key}: ${count}`);
            }

            lines.push('', '## Review Items', '');
            for (const review of reviews.slice(-20)) {
                lines.push(`- chunk ${review.chunkIndex} [${review.stage}] ${review.failure}: ${review.reason}`);
            }
        }

        if (candidates.length > 0) {
            lines.push('', '## Lexicon Candidates', '');
            for (const candidate of candidates.slice(-20)) {
                lines.push(`- ${candidate.candidate} (${candidate.stage}${candidate.targetLang ? `/${candidate.targetLang}` : ''})`);
            }
        }

        fs.writeFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf-8');
    }

    private readJsonArray<T>(filePath: string): T[] {
        if (!fs.existsSync(filePath)) {
            return [];
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return Array.isArray(parsed) ? parsed as T[] : [];
        } catch {
            return [];
        }
    }
}
