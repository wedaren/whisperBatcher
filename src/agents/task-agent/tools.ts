import type { SubtitleFlowApi } from '../../publicApi';
import type * as vscode from 'vscode';

export interface TaskAgentToolManifest {
    key: 'listTasks' | 'listBatches' | 'getLatestBatch' | 'getTask' | 'summarizeTaskResult' | 'enqueueTask' | 'enqueueTasks' | 'scanDirectory' | 'runPending' | 'pauseTask' | 'resumeTask' | 'retryTask' | 'deleteTask';
    name: string;
    displayName: string;
    modelDescription: string;
    inputSchema: Record<string, unknown>;
    tags: string[];
    invocationMessage: (input: Record<string, unknown>) => string;
    confirmation?: (input: Record<string, unknown>) => vscode.LanguageModelToolConfirmationMessages;
    invoke: (api: SubtitleFlowApi, input: Record<string, unknown>) => Promise<unknown>;
}

function confirmation(title: string, message: string): vscode.LanguageModelToolConfirmationMessages {
    return { title, message };
}

/**
 * TaskAgent 工具注册与 manifest 的唯一来源。
 * package.json、toolNames、participant、agentHost 都应该尽量复用这份声明。
 */
export const TASK_AGENT_TOOL_MANIFESTS: TaskAgentToolManifest[] = [
    {
        key: 'listTasks',
        name: 'subtitleflow_list_tasks',
        displayName: 'List Subtitle Tasks',
        modelDescription: 'List subtitle workflow tasks with status and outputs.',
        inputSchema: { type: 'object', properties: {} },
        tags: ['subtitle', 'tasks', 'read'],
        invocationMessage: () => '正在读取字幕任务列表',
        invoke: async (api) => api.listTasks(),
    },
    {
        key: 'listBatches',
        name: 'subtitleflow_list_batches',
        displayName: 'List Subtitle Batches',
        modelDescription: 'List recent subtitle task batches with aggregated progress counters.',
        inputSchema: { type: 'object', properties: {} },
        tags: ['subtitle', 'tasks', 'read', 'batch'],
        invocationMessage: () => '正在读取最近字幕批次',
        invoke: async (api) => api.listBatches(),
    },
    {
        key: 'getLatestBatch',
        name: 'subtitleflow_get_latest_batch',
        displayName: 'Get Latest Subtitle Batch',
        modelDescription: 'Read the latest subtitle task batch summary.',
        inputSchema: { type: 'object', properties: {} },
        tags: ['subtitle', 'tasks', 'read', 'batch'],
        invocationMessage: () => '正在读取最近批次状态',
        invoke: async (api) => api.getLatestBatch() ?? null,
    },
    {
        key: 'getTask',
        name: 'subtitleflow_get_task',
        displayName: 'Get Subtitle Task',
        modelDescription: 'Get a subtitle task by task id.',
        inputSchema: {
            type: 'object',
            properties: { taskId: { type: 'string' } },
            required: ['taskId'],
        },
        tags: ['subtitle', 'tasks', 'read'],
        invocationMessage: (input) => `正在读取任务 ${String(input.taskId)}`,
        invoke: async (api, input) => api.getTask(String(input.taskId)) ?? null,
    },
    {
        key: 'summarizeTaskResult',
        name: 'subtitleflow_summarize_task_result',
        displayName: 'Summarize Subtitle Result',
        modelDescription: 'Summarize output files and review artifacts for one subtitle task.',
        inputSchema: {
            type: 'object',
            properties: { taskId: { type: 'string' } },
            required: ['taskId'],
        },
        tags: ['subtitle', 'tasks', 'read', 'result'],
        invocationMessage: (input) => `正在汇总任务 ${String(input.taskId)} 的输出结果`,
        invoke: async (api, input) => api.summarizeTaskResult(String(input.taskId)) ?? null,
    },
    {
        key: 'enqueueTask',
        name: 'subtitleflow_enqueue_task',
        displayName: 'Enqueue Subtitle Task',
        modelDescription: 'Create a queued subtitle generation task for an absolute video path.',
        inputSchema: {
            type: 'object',
            properties: {
                videoPath: { type: 'string' },
                whisperModel: { type: 'string' },
                whisperLanguage: { type: 'string' },
                targetLanguages: { type: 'array', items: { type: 'string' } },
            },
            required: ['videoPath'],
        },
        tags: ['subtitle', 'tasks', 'write'],
        invocationMessage: (input) => `正在为 ${String(input.videoPath)} 创建后台字幕任务`,
        confirmation: (input) => confirmation(
            '确认创建字幕任务？',
            `将为 \`${String(input.videoPath)}\` 创建一个新的后台任务。`
        ),
        invoke: async (api, input) => api.enqueueTask({ videoPath: String(input.videoPath) }, input),
    },
    {
        key: 'enqueueTasks',
        name: 'subtitleflow_enqueue_tasks',
        displayName: 'Enqueue Subtitle Tasks',
        modelDescription: 'Create queued subtitle generation tasks for multiple absolute video paths.',
        inputSchema: {
            type: 'object',
            properties: {
                inputs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: { videoPath: { type: 'string' } },
                        required: ['videoPath'],
                    },
                },
                whisperModel: { type: 'string' },
                whisperLanguage: { type: 'string' },
                targetLanguages: { type: 'array', items: { type: 'string' } },
            },
            required: ['inputs'],
        },
        tags: ['subtitle', 'tasks', 'write', 'batch'],
        invocationMessage: (input) => `正在批量创建 ${Array.isArray(input.inputs) ? input.inputs.length : 0} 个字幕任务`,
        confirmation: (input) => confirmation(
            '确认批量创建字幕任务？',
            `将为 ${Array.isArray(input.inputs) ? input.inputs.length : 0} 个视频创建后台任务。`
        ),
        invoke: async (api, input) => api.enqueueTasks(
            Array.isArray(input.inputs) ? input.inputs.map((item) => ({ videoPath: String((item as { videoPath: unknown }).videoPath) })) : [],
            input
        ),
    },
    {
        key: 'scanDirectory',
        name: 'subtitleflow_scan_directory',
        displayName: 'Scan Subtitle Directory',
        modelDescription: 'Scan a directory and return video files that can be enqueued for subtitle generation.',
        inputSchema: {
            type: 'object',
            properties: {
                directoryPath: { type: 'string' },
                recursive: { type: 'boolean' },
                maxFiles: { type: 'number' },
            },
            required: ['directoryPath'],
        },
        tags: ['subtitle', 'tasks', 'read', 'filesystem'],
        invocationMessage: (input) => `正在扫描目录 ${String(input.directoryPath)} 中的视频文件`,
        confirmation: (input) => confirmation(
            '确认扫描目录？',
            `将扫描目录 \`${String(input.directoryPath)}\` 中可处理的视频文件。`
        ),
        invoke: async (api, input) => api.scanDirectory(String(input.directoryPath), {
            recursive: Boolean(input.recursive),
            maxFiles: typeof input.maxFiles === 'number' ? input.maxFiles : undefined,
        }),
    },
    {
        key: 'runPending',
        name: 'subtitleflow_run_pending',
        displayName: 'Run Pending Subtitle Tasks',
        modelDescription: 'Ask the background scheduler to start queued subtitle tasks.',
        inputSchema: { type: 'object', properties: {} },
        tags: ['subtitle', 'tasks', 'write'],
        invocationMessage: () => '正在启动排队中的字幕任务',
        confirmation: () => confirmation('确认启动排队任务？', '将尝试启动当前处于队列中的字幕任务。'),
        invoke: async (api) => {
            api.runPending();
            return { ok: true, started: true, message: 'Pending subtitle tasks were handed to the scheduler.' };
        },
    },
    {
        key: 'pauseTask',
        name: 'subtitleflow_pause_task',
        displayName: 'Pause Subtitle Task',
        modelDescription: 'Pause a running subtitle task.',
        inputSchema: {
            type: 'object',
            properties: { taskId: { type: 'string' } },
            required: ['taskId'],
        },
        tags: ['subtitle', 'tasks', 'write'],
        invocationMessage: (input) => `正在暂停任务 ${String(input.taskId)}`,
        confirmation: (input) => confirmation('确认暂停字幕任务？', `运行中的任务 \`${String(input.taskId)}\` 将被暂停。`),
        invoke: async (api, input) => {
            const taskId = String(input.taskId);
            api.pauseTask(taskId);
            return { ok: true, taskId };
        },
    },
    {
        key: 'resumeTask',
        name: 'subtitleflow_resume_task',
        displayName: 'Resume Subtitle Task',
        modelDescription: 'Resume a paused subtitle task.',
        inputSchema: {
            type: 'object',
            properties: { taskId: { type: 'string' } },
            required: ['taskId'],
        },
        tags: ['subtitle', 'tasks', 'write'],
        invocationMessage: (input) => `正在恢复任务 ${String(input.taskId)}`,
        confirmation: (input) => confirmation('确认恢复字幕任务？', `已暂停的任务 \`${String(input.taskId)}\` 将重新进入队列。`),
        invoke: async (api, input) => {
            const taskId = String(input.taskId);
            api.resumeTask(taskId);
            return { ok: true, taskId };
        },
    },
    {
        key: 'retryTask',
        name: 'subtitleflow_retry_task',
        displayName: 'Retry Subtitle Task',
        modelDescription: 'Retry a failed subtitle task.',
        inputSchema: {
            type: 'object',
            properties: { taskId: { type: 'string' } },
            required: ['taskId'],
        },
        tags: ['subtitle', 'tasks', 'write'],
        invocationMessage: (input) => `正在重试任务 ${String(input.taskId)}`,
        confirmation: (input) => confirmation('确认重试字幕任务？', `失败的任务 \`${String(input.taskId)}\` 将重新进入队列。`),
        invoke: async (api, input) => {
            const taskId = String(input.taskId);
            api.retryTask(taskId);
            return { ok: true, taskId };
        },
    },
    {
        key: 'deleteTask',
        name: 'subtitleflow_delete_task',
        displayName: 'Delete Subtitle Task',
        modelDescription: 'Delete a subtitle task record but keep output files.',
        inputSchema: {
            type: 'object',
            properties: { taskId: { type: 'string' } },
            required: ['taskId'],
        },
        tags: ['subtitle', 'tasks', 'write'],
        invocationMessage: (input) => `正在删除任务 ${String(input.taskId)}`,
        confirmation: (input) => confirmation('确认删除任务记录？', `将删除任务 \`${String(input.taskId)}\` 的记录，但不会删除已有输出文件。`),
        invoke: async (api, input) => {
            const taskId = String(input.taskId);
            return { ok: api.deleteTask(taskId), taskId };
        },
    },
];

export const TASK_AGENT_TOOLS = Object.freeze(
    TASK_AGENT_TOOL_MANIFESTS.reduce((accumulator, tool) => {
        accumulator[tool.key] = tool.name;
        return accumulator;
    }, {} as Record<TaskAgentToolManifest['key'], string>)
);
