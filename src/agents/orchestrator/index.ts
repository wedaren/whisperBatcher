import { ExecutionAgent, type RecoveryAttemptState, type RecoveryDecision, type RecoveryFailureKind, type RecoveryStage } from '../execution-agent';
import { ReviewAgent, type ReviewFailureInput } from '../review-agent';

export interface AgentFailureContext extends ReviewFailureInput {}

/**
 * orchestrator 负责 agent handoff：
 * 1. 先调用 ExecutionAgent 决定是否继续执行
 * 2. 若已决定降级，再交给 ReviewAgent 写工件
 */
export class AgentOrchestrator {
    constructor(
        private readonly executionAgent: ExecutionAgent = new ExecutionAgent(),
        private readonly reviewAgent: ReviewAgent = new ReviewAgent()
    ) {}

    handleFailure(
        outDir: string,
        stage: RecoveryStage,
        state: RecoveryAttemptState,
        failure: RecoveryFailureKind,
        reviewContext: AgentFailureContext
    ): RecoveryDecision {
        const decision = this.executionAgent.decide(stage, state, failure);
        if (!decision.shouldRetry) {
            this.reviewAgent.recordFailure(outDir, {
                ...reviewContext,
                fallbackMode: decision.fallbackMode,
                reason: decision.reason,
            });
        }
        return decision;
    }
}
