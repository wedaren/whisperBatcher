import * as vscode from 'vscode';
import type { SubtitleFlowApi } from '../publicApi';
import { SUBTITLE_FLOW_TOOL_MANIFESTS } from '../subtitleFlowRegistry';

/**
 * 将公共 API 返回值统一包装成 JSON 文本，
 * 便于模型和用户直接理解任务状态与产物路径。
 */
function asToolResult(payload: unknown): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2)),
    ]);
}

/**
 * 注册 Subtitle Flow 的 Copilot tools。
 * 这些工具全部走任务控制面，不在单次工具调用里等待整个 Whisper 流程结束。
 */
export function registerSubtitleFlowTools(
    context: vscode.ExtensionContext,
    api: SubtitleFlowApi
): void {
    context.subscriptions.push(...SUBTITLE_FLOW_TOOL_MANIFESTS.map((tool) =>
        vscode.lm.registerTool(tool.name, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>) =>
                asToolResult(await tool.invoke(api, options.input)),
            prepareInvocation: ({ input }) => ({
                invocationMessage: tool.invocationMessage(input as Record<string, unknown>),
                confirmationMessages: tool.confirmation?.(input as Record<string, unknown>),
            }),
        })
    ));
}
