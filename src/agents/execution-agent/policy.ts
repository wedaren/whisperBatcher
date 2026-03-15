import type { RecoveryAttemptState, RecoveryDecision, RecoveryFailureKind, RecoveryStage } from './types';

const MAX_RECOVERY_ATTEMPTS = 4;
const MIN_CHUNK_SIZE = 5;

function halveChunkSize(size: number): number {
    return Math.max(MIN_CHUNK_SIZE, Math.floor(size / 2));
}

/**
 * ExecutionAgent 的策略核心。
 * 这里只负责决定“是否继续执行、下次用什么 prompt、是否直接降级”，不负责写工件。
 */
export class ExecutionAgent {
    decide(stage: RecoveryStage, state: RecoveryAttemptState, failure: RecoveryFailureKind): RecoveryDecision {
        const nextAttempt = state.attempt + 1;
        const fallbackMode = stage === 'translate' ? 'sanitized_source' : 'sanitized_source';

        if (failure === 'refusal' && nextAttempt >= 2) {
            return {
                shouldRetry: false,
                nextChunkSize: state.chunkSize,
                nextPromptVariant: state.promptVariant,
                reason: '拒答后已完成一次保守重试，直接转入降级模式',
                fallbackMode,
            };
        }

        if (nextAttempt >= MAX_RECOVERY_ATTEMPTS) {
            return {
                shouldRetry: false,
                nextChunkSize: state.chunkSize,
                nextPromptVariant: state.promptVariant,
                reason: '已达到最大恢复尝试次数，转入降级模式',
                fallbackMode,
            };
        }

        if (failure === 'call_error') {
            return {
                shouldRetry: true,
                nextChunkSize: state.chunkSize,
                nextPromptVariant: state.promptVariant,
                reason: 'LLM 调用失败，保留当前 prompt 与块大小重试一次',
                fallbackMode,
            };
        }

        if (failure === 'refusal') {
            if (state.promptVariant !== 'reduced_risk') {
                return {
                    shouldRetry: true,
                    nextChunkSize: state.chunkSize,
                    nextPromptVariant: 'reduced_risk',
                    reason: '检测到安全拒答，切换到更保守的低风险 prompt',
                    fallbackMode,
                };
            }
            if (state.chunkSize > MIN_CHUNK_SIZE) {
                return {
                    shouldRetry: true,
                    nextChunkSize: halveChunkSize(state.chunkSize),
                    nextPromptVariant: state.promptVariant,
                    reason: '低风险 prompt 仍被拒绝，缩小 chunk 后继续尝试',
                    fallbackMode,
                };
            }
        }

        if (failure === 'parse_mismatch' || failure === 'prompt_leak' || failure === 'compliance_leak') {
            if (state.promptVariant === 'standard') {
                return {
                    shouldRetry: true,
                    nextChunkSize: state.chunkSize,
                    nextPromptVariant: 'strict_format',
                    reason: '输出格式不稳定，切换到更严格的格式约束 prompt',
                    fallbackMode,
                };
            }
            if (state.chunkSize > MIN_CHUNK_SIZE) {
                return {
                    shouldRetry: true,
                    nextChunkSize: halveChunkSize(state.chunkSize),
                    nextPromptVariant: state.promptVariant,
                    reason: '格式问题仍存在，缩小 chunk 降低上下文复杂度',
                    fallbackMode,
                };
            }
        }

        if (failure === 'untranslated') {
            if (state.promptVariant !== 'strict_format') {
                return {
                    shouldRetry: true,
                    nextChunkSize: state.chunkSize,
                    nextPromptVariant: 'strict_format',
                    reason: '检测到疑似未翻译输出，切换到更明确的执行 prompt',
                    fallbackMode,
                };
            }
            if (state.chunkSize > MIN_CHUNK_SIZE) {
                return {
                    shouldRetry: true,
                    nextChunkSize: halveChunkSize(state.chunkSize),
                    nextPromptVariant: state.promptVariant,
                    reason: '仍疑似未翻译，缩小 chunk 后重试',
                    fallbackMode,
                };
            }
        }

        return {
            shouldRetry: false,
            nextChunkSize: state.chunkSize,
            nextPromptVariant: state.promptVariant,
            reason: '没有更优恢复策略，转入降级模式',
            fallbackMode,
        };
    }
}
