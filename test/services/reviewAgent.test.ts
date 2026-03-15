/**
 * ReviewAgent 单元测试。
 * 验证失败块会写入复核工件与候选词文件。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ReviewAgent } from '../../src/agents/review-agent';

describe('ReviewAgent', () => {
    let tmpDir: string;
    let agent: ReviewAgent;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-agent-test-'));
        agent = new ReviewAgent();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should write manual review and lexicon candidates for refusal failures', () => {
        agent.recordFailure(tmpDir, {
            stage: 'translate',
            chunkIndex: 2,
            chunkEntries: [
                { index: 10, startTime: '00:00:01,000', endTime: '00:00:02,000', text: 'sample line' },
            ],
            sanitizedTexts: ['high risk sample token'],
            failure: 'refusal',
            promptVariant: 'reduced_risk',
            fallbackMode: 'sanitized_source',
            reason: '拒答后已完成一次保守重试，直接转入降级模式',
            targetLang: 'zh-CN',
        });

        const reviewFile = path.join(tmpDir, 'manual-review.json');
        const candidateFile = path.join(tmpDir, 'lexicon-candidates.json');
        const summaryFile = path.join(tmpDir, 'recovery-summary.md');
        assert.equal(fs.existsSync(reviewFile), true);
        assert.equal(fs.existsSync(candidateFile), true);
        assert.equal(fs.existsSync(summaryFile), true);

        const reviews = JSON.parse(fs.readFileSync(reviewFile, 'utf-8'));
        const candidates = JSON.parse(fs.readFileSync(candidateFile, 'utf-8'));
        assert.equal(reviews.length, 1);
        assert.equal(reviews[0].failure, 'refusal');
        assert.equal(candidates.length > 0, true);
        assert.equal(candidates[0].status, 'pending');
    });

    it('should only write manual review for non-refusal failures', () => {
        agent.recordFailure(tmpDir, {
            stage: 'optimize',
            chunkIndex: 1,
            chunkEntries: [
                { index: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', text: 'sample line' },
            ],
            sanitizedTexts: ['sample line'],
            failure: 'parse_mismatch',
            promptVariant: 'strict_format',
            fallbackMode: 'sanitized_source',
            reason: '格式问题仍存在，转入降级模式',
        });

        const reviewFile = path.join(tmpDir, 'manual-review.json');
        const candidateFile = path.join(tmpDir, 'lexicon-candidates.json');
        const summaryFile = path.join(tmpDir, 'recovery-summary.md');
        assert.equal(fs.existsSync(reviewFile), true);
        assert.equal(fs.existsSync(candidateFile), false);
        assert.equal(fs.existsSync(summaryFile), true);
    });
});
