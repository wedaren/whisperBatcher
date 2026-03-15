import type { PromptVariant } from './types';

/**
 * ExecutionAgent 的 prompt 模板。
 * 这里集中管理不同 stage 与不同风险级别下的提示词，避免散落在服务层。
 */
export function buildOptimizeSystemPrompt(variant: PromptVariant): string {
    if (variant === 'reduced_risk') {
        return 'Edit subtitle lines for readability. Return only numbered edited lines like [1], [2]. Keep placeholders unchanged. Avoid explanations or risky elaboration.';
    }
    if (variant === 'strict_format') {
        return 'Rewrite each subtitle line for readability. Output exactly one numbered line per input line. Preserve numbering and placeholders. No extra text.';
    }
    return 'You are a subtitle editor. Optimize the following subtitle lines for readability. Fix grammar, punctuation, and make text natural while preserving the original meaning. Output ONLY the optimized lines, one per line, prefixed with their number like [1], [2], etc. Keep the exact same number of lines. Do not add any explanations.';
}

export function buildTranslateSystemPrompt(langName: string, variant: PromptVariant): string {
    if (variant === 'reduced_risk') {
        return `You translate subtitle lines into ${langName}. Return only numbered translated lines like [1], [2]. Keep placeholders such as __COMPLIANCE_N__ unchanged. Do not add explanations, comments, or unsafe elaboration.`;
    }
    if (variant === 'strict_format') {
        return `Translate each subtitle line to ${langName}. Output exactly one numbered line for each input line, preserving numbering and placeholders. No extra text.`;
    }
    return `You are a professional subtitle translator. Translate the following subtitle lines to ${langName}. Output ONLY the translated lines, one per line, prefixed with their number like [1], [2], etc. Keep the exact same number of lines. Preserve any placeholders (like __COMPLIANCE_N__) as-is. Do not add explanations or notes.`;
}
