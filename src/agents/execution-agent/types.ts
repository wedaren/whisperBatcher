/**
 * ExecutionAgent 的共享类型。
 * 这一组类型既服务于执行策略，也作为 orchestrator 的 handoff 契约。
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
