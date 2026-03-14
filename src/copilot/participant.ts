import * as vscode from 'vscode';
import type { SubtitleFlowApi } from '../publicApi';
import { parseParticipantIntent, renderParticipantHelp } from './participantParser';
import { inferParticipantIntent } from './agentPlanner';
import { buildAgentWorkflow, snapshotTasks } from './agentOrchestrator';
import { SUBTITLE_FLOW_CHAT_PARTICIPANT_ID, SUBTITLE_FLOW_TOOL_NAMES } from './toolNames';

function toolCall(
    request: vscode.ChatRequest,
    name: string,
    input: Record<string, unknown>,
    token: vscode.CancellationToken
): Thenable<vscode.LanguageModelToolResult> {
    return vscode.lm.invokeTool(
        name,
        {
            toolInvocationToken: request.toolInvocationToken,
            input,
        },
        token
    );
}

function toolResultToMarkdown(result: vscode.LanguageModelToolResult): string {
    return result.content
        .map((part) => part instanceof vscode.LanguageModelTextPart ? part.value : '')
        .filter(Boolean)
        .join('\n');
}

async function respondWithTool(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    name: string,
    input: Record<string, unknown>,
    summary: string
): Promise<string> {
    stream.progress(summary);
    const result = await toolCall(request, name, input, token);
    const content = toolResultToMarkdown(result);
    stream.markdown(['```json', content, '```'].join('\n'));
    return content;
}

function tryParseToolPayload(content: string): Record<string, unknown> | undefined {
    try {
        return JSON.parse(content) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function extractTaskId(payload: Record<string, unknown> | undefined): string | undefined {
    return typeof payload?.id === 'string'
        ? payload.id
        : typeof payload?.taskId === 'string'
            ? payload.taskId
            : undefined;
}

async function inspectTask(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    taskId: string,
    summary: string
): Promise<void> {
    await respondWithTool(
        request,
        stream,
        token,
        SUBTITLE_FLOW_TOOL_NAMES.getTask,
        { taskId },
        summary
    );
}

export function createSubtitleFlowParticipantHandler(api: SubtitleFlowApi): vscode.ChatRequestHandler {
    return async (request, chatContext, stream, token) => {
        void chatContext;
        const tasks = snapshotTasks(api);
        const explicitIntent = parseParticipantIntent(request.command, request.prompt);
        const intent = inferParticipantIntent(request.prompt, tasks, explicitIntent);
        const workflow = buildAgentWorkflow(intent, tasks);

        if (!workflow) {
            stream.markdown(renderParticipantHelp());
            return {
                metadata: {
                    taskCount: api.listTasks().length,
                },
            };
        }

        let lastPayload: Record<string, unknown> | undefined;
        let lastKnownTaskId: string | undefined;
        for (let index = 0; index < workflow.steps.length; index++) {
            const step = workflow.steps[index];
            const content = await respondWithTool(
                request,
                stream,
                token,
                step.toolName,
                step.input,
                step.summary
            );
            lastPayload = tryParseToolPayload(content);
            const extractedTaskId = extractTaskId(lastPayload);
            if (extractedTaskId) {
                lastKnownTaskId = extractedTaskId;
            }

            if (workflow.inspectTaskAfterStep === index) {
                const taskId = lastKnownTaskId;
                if (taskId) {
                    await inspectTask(request, stream, token, taskId, `正在读取任务 ${taskId} 的当前状态`);
                }
            }
        }

        if (workflow.listTasksAfterExecution) {
            await respondWithTool(
                request,
                stream,
                token,
                SUBTITLE_FLOW_TOOL_NAMES.listTasks,
                {},
                '正在刷新字幕任务列表'
            );
        }

        if (workflow.finalMessage) {
            stream.markdown(workflow.finalMessage);
        }

        return {
            metadata: {
                taskCount: api.listTasks().length,
            },
        };
    };
}

/**
 * 注册 `@subtitleFlow` 聊天 participant。
 * 它只负责把自然语言转换成任务控制动作，不直接承载长时间运行的 Whisper 阻塞过程。
 */
export function registerSubtitleFlowParticipant(
    context: vscode.ExtensionContext,
    api: SubtitleFlowApi
): void {
    const participant = vscode.chat.createChatParticipant(
        SUBTITLE_FLOW_CHAT_PARTICIPANT_ID,
        createSubtitleFlowParticipantHandler(api)
    );

    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg');
    participant.followupProvider = {
        provideFollowups: () => [
            { prompt: '/list', label: '列出任务' },
            { prompt: '/run', label: '启动队列' },
            { prompt: '/enqueue "/absolute/path/video.mp4"', label: '创建任务' },
        ],
    };

    context.subscriptions.push(participant);
}
