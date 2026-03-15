import type { AgentManifest } from '../../publicApi';

/**
 * ExecutionAgent 的自描述信息。
 * 这份清单用于插件级 Agent Host 暴露内部能力边界。
 */
export const EXECUTION_AGENT_MANIFEST: AgentManifest = {
    name: 'execution-agent',
    description: '负责 optimize / translate 阶段的恢复策略与快速降级决策。',
    responsibilities: [
        '根据 refusal、parse_mismatch 等失败类型选择恢复策略',
        '控制重试次数、prompt 变体和降级模式',
        '保证主任务尽量继续执行而不是长时间阻塞',
    ],
    tools: [
        'recovery_policy_decision',
        'optimize_prompt_builder',
        'translate_prompt_builder',
    ],
    capabilityNames: [
        'subtitle.optimize',
        'subtitle.translate',
    ],
    inputSchemaSummary: '字幕文件路径、目标语言、恢复状态和 prompt 变体。',
    outputSchemaSummary: 'OptimizeResult、TranslateResult 或 RecoveryDecision。',
};
