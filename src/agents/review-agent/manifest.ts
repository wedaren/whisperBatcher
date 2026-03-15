import type { AgentManifest } from '../../publicApi';

/**
 * ReviewAgent 的自描述信息。
 * 它只负责失败块归因和工件产出，不参与主链路重试。
 */
export const REVIEW_AGENT_MANIFEST: AgentManifest = {
    name: 'review-agent',
    description: '负责记录失败块、生成 review artifact 和候选词清单。',
    responsibilities: [
        '写入 manual-review.json',
        '写入 lexicon-candidates.json',
        '为人工复核提供结构化失败上下文',
    ],
    tools: [
        'record_review_failure',
        'extract_lexicon_candidates',
    ],
    capabilityNames: [
        'review.inspect-failures',
    ],
    inputSchemaSummary: '失败块上下文、失败类型、降级方式和输出目录。',
    outputSchemaSummary: 'manual-review.json 与 lexicon-candidates.json 的结构化信息。',
};
