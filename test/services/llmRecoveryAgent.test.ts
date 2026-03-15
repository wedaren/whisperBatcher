/**
 * LLM 恢复 agent 单元测试。
 * 验证失败分类到恢复策略的映射是否符合预期。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionAgent } from '../../src/agents/execution-agent';

describe('LlmRecoveryAgent', () => {
    const agent = new ExecutionAgent();

    it('should switch to reduced-risk prompt on refusal', () => {
        const decision = agent.decide('translate', {
            attempt: 0,
            chunkSize: 20,
            promptVariant: 'standard',
            failures: [],
        }, 'refusal');

        assert.equal(decision.shouldRetry, true);
        assert.equal(decision.nextPromptVariant, 'reduced_risk');
    });

    it('should switch to strict-format prompt on parse mismatch', () => {
        const decision = agent.decide('optimize', {
            attempt: 0,
            chunkSize: 20,
            promptVariant: 'standard',
            failures: [],
        }, 'parse_mismatch');

        assert.equal(decision.shouldRetry, true);
        assert.equal(decision.nextPromptVariant, 'strict_format');
    });

    it('should stop retrying after max attempts', () => {
        const decision = agent.decide('translate', {
            attempt: 3,
            chunkSize: 20,
            promptVariant: 'reduced_risk',
            failures: ['refusal', 'refusal', 'refusal'],
        }, 'refusal');

        assert.equal(decision.shouldRetry, false);
    });
});
