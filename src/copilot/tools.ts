import * as vscode from 'vscode';
import type { SubtitleFlowApi } from '../publicApi';
import { SUBTITLE_FLOW_TOOL_NAMES } from './toolNames';

/**
 * 将公共 API 返回值统一包装成 JSON 文本，
 * 便于模型和用户直接理解任务状态与产物路径。
 */
function asToolResult(payload: unknown): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(payload, null, 2)),
    ]);
}

function confirmation(title: string, message: string): vscode.LanguageModelToolConfirmationMessages {
    return { title, message };
}

/**
 * 注册 Subtitle Flow 的 Copilot tools。
 * 这些工具全部走任务控制面，不在单次工具调用里等待整个 Whisper 流程结束。
 */
export function registerSubtitleFlowTools(
    context: vscode.ExtensionContext,
    api: SubtitleFlowApi
): void {
    context.subscriptions.push(
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.listTasks, {
            invoke: async () => asToolResult(api.listTasks()),
            prepareInvocation: () => ({ invocationMessage: '正在读取字幕任务列表' }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.getTask, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<{ taskId: string }>) =>
                asToolResult(api.getTask(options.input.taskId) ?? null),
            prepareInvocation: ({ input }) => ({
                invocationMessage: `正在读取任务 ${input.taskId}`,
            }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.enqueueTask, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<{
                videoPath: string;
                whisperModel?: string;
                whisperLanguage?: string;
                targetLanguages?: string[];
            }>) => asToolResult(await api.enqueueTask({ videoPath: options.input.videoPath }, options.input)),
            prepareInvocation: ({ input }) => ({
                invocationMessage: `正在为 ${input.videoPath} 创建后台字幕任务`,
                confirmationMessages: confirmation(
                    '确认创建字幕任务？',
                    `将为 \`${input.videoPath}\` 创建一个新的后台任务。`
                ),
            }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.runPending, {
            invoke: async () => {
                api.runPending();
                return asToolResult({
                    ok: true,
                    started: true,
                    message: 'Pending subtitle tasks were handed to the scheduler.',
                });
            },
            prepareInvocation: () => ({
                invocationMessage: '正在启动排队中的字幕任务',
                confirmationMessages: confirmation(
                    '确认启动排队任务？',
                    '将尝试启动当前处于队列中的字幕任务。'
                ),
            }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.pauseTask, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<{ taskId: string }>) => {
                api.pauseTask(options.input.taskId);
                return asToolResult({ ok: true, taskId: options.input.taskId });
            },
            prepareInvocation: ({ input }) => ({
                invocationMessage: `正在暂停任务 ${input.taskId}`,
                confirmationMessages: confirmation(
                    '确认暂停字幕任务？',
                    `运行中的任务 \`${input.taskId}\` 将被暂停。`
                ),
            }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.resumeTask, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<{ taskId: string }>) => {
                api.resumeTask(options.input.taskId);
                return asToolResult({ ok: true, taskId: options.input.taskId });
            },
            prepareInvocation: ({ input }) => ({
                invocationMessage: `正在恢复任务 ${input.taskId}`,
                confirmationMessages: confirmation(
                    '确认恢复字幕任务？',
                    `已暂停的任务 \`${input.taskId}\` 将重新进入队列。`
                ),
            }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.retryTask, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<{ taskId: string }>) => {
                api.retryTask(options.input.taskId);
                return asToolResult({ ok: true, taskId: options.input.taskId });
            },
            prepareInvocation: ({ input }) => ({
                invocationMessage: `正在重试任务 ${input.taskId}`,
                confirmationMessages: confirmation(
                    '确认重试字幕任务？',
                    `失败的任务 \`${input.taskId}\` 将重新进入队列。`
                ),
            }),
        }),
        vscode.lm.registerTool(SUBTITLE_FLOW_TOOL_NAMES.deleteTask, {
            invoke: async (options: vscode.LanguageModelToolInvocationOptions<{ taskId: string }>) =>
                asToolResult({ ok: api.deleteTask(options.input.taskId), taskId: options.input.taskId }),
            prepareInvocation: ({ input }) => ({
                invocationMessage: `正在删除任务 ${input.taskId}`,
                confirmationMessages: confirmation(
                    '确认删除任务记录？',
                    `将删除任务 \`${input.taskId}\` 的记录，但不会删除已有输出文件。`
                ),
            }),
        })
    );
}
