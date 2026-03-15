import * as vscode from 'vscode';
import type { SubtitleFlowApi, TaskSummary } from '../../publicApi';
import type { AgentRuntime } from './types';

function toolResultToMarkdown(result: vscode.LanguageModelToolResult): string {
    return result.content
        .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : '')
        .filter(Boolean)
        .join('\n');
}

/**
 * 创建统一 AgentRuntime。
 * 这样 task-agent、后续更复杂的交互 agent 都可以共享同一套运行上下文。
 */
export function createAgentRuntime(
    api: SubtitleFlowApi,
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): AgentRuntime {
    return {
        api,
        request,
        stream,
        token,
        listTasks(): TaskSummary[] {
            return api.listTasks();
        },
        async invokeTool(name: string, input: Record<string, unknown>, summary: string): Promise<string> {
            stream.progress(summary);
            const result = await vscode.lm.invokeTool(
                name,
                {
                    toolInvocationToken: request.toolInvocationToken,
                    input,
                },
                token
            );
            const content = toolResultToMarkdown(result);
            stream.markdown(['```json', content, '```'].join('\n'));
            return content;
        },
    };
}

export type { AgentRuntime } from './types';
