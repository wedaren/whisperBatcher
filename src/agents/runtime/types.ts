import type * as vscode from 'vscode';
import type { SubtitleFlowApi, TaskSummary } from '../../publicApi';

/**
 * AgentRuntime 负责承接 VS Code Chat / Tool 的底层交互能力。
 * 各个 agent 不直接操作全局 `vscode.lm`，而是通过 runtime 执行工具和读取状态。
 */
export interface AgentRuntime {
    readonly api: SubtitleFlowApi;
    readonly request: vscode.ChatRequest;
    readonly stream: vscode.ChatResponseStream;
    readonly token: vscode.CancellationToken;
    listTasks(): TaskSummary[];
    invokeTool(name: string, input: Record<string, unknown>, summary: string): Promise<string>;
}
