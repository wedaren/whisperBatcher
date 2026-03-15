/**
 * LLM 恢复 agent。
 * 它不是开放式聊天 agent，而是一个受控策略引擎：
 * 根据失败类型、已尝试策略和块大小，决定下一次调用该如何收敛。
 */

export type RecoveryStage = 'optimize' | 'translate';

export type RecoveryFailureKind =
    | 'call_error'
    | 'refusal'
    | 'parse_mismatch'
    | 'untranslated'
    | 'prompt_leak'
    | 'compliance_leak';

export type PromptVariant =
    | 'standard'
    | 'strict_format'
    | 'reduced_risk';

export interface RecoveryAttemptState {
    attempt: number;
    chunkSize: number;
    promptVariant: PromptVariant;
    failures: RecoveryFailureKind[];
}

export interface RecoveryDecision {
    shouldRetry: boolean;
    nextChunkSize: number;
    nextPromptVariant: PromptVariant;
    reason: string;
    fallbackMode: 'sanitized_source' | 'original_source';
}

const MAX_RECOVERY_ATTEMPTS = 4;
const MIN_CHUNK_SIZE = 5;

function halveChunkSize(size: number): number {
    return Math.max(MIN_CHUNK_SIZE, Math.floor(size / 2));
}

/**
 * 根据失败类型为下一次重试生成策略。
 * 目标是优先尝试格式收敛，再缩小输入，再最终降级。
 */
export class LlmRecoveryAgent {
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
