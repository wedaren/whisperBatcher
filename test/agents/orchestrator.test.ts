/**
 * orchestrator 测试。
 * 验证 ExecutionAgent 与 ReviewAgent 的 handoff 由 orchestrator 统一完成。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentOrchestrator } from '../../src/agents/orchestrator';

describe('AgentOrchestrator', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-orchestrator-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should hand off to ReviewAgent when ExecutionAgent decides to fallback', () => {
        const orchestrator = new AgentOrchestrator();
        const decision = orchestrator.handleFailure(
            tmpDir,
            'translate',
            {
                attempt: 1,
                chunkSize: 20,
                promptVariant: 'reduced_risk',
                failures: ['refusal'],
            },
            'refusal',
            {
                stage: 'translate',
                chunkIndex: 3,
                chunkEntries: [
                    { index: 10, startTime: '00:00:01,000', endTime: '00:00:02,000', text: 'sample text' },
                ],
                sanitizedTexts: ['sample refusal text'],
                failure: 'refusal',
                promptVariant: 'reduced_risk',
                fallbackMode: 'sanitized_source',
                reason: '',
                targetLang: 'zh-CN',
            }
        );

        assert.equal(decision.shouldRetry, false);
        assert.equal(fs.existsSync(path.join(tmpDir, 'manual-review.json')), true);
        assert.equal(fs.existsSync(path.join(tmpDir, 'lexicon-candidates.json')), true);
    });
});
