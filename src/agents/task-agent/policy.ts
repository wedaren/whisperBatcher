import type { SubtitleFlowApi, TaskSummary } from '../../publicApi';
import { extractDirectoryPath, extractTaskId, extractVideoPath } from './parser';
import { TASK_AGENT_TOOLS } from './tools';
import type { TaskAgentIntent, TaskAgentSubtitlePreference, TaskAgentWorkflow } from './types';

function inferSubtitlePreference(prompt: string): TaskAgentSubtitlePreference {
    const normalized = prompt.trim().toLowerCase();
    if (/中文字幕|简中|zh-cn/i.test(normalized)) {
        return {
            targetLanguages: ['zh-CN'],
            defaultSubtitleLanguage: 'zh-CN',
            generateBilingualAss: true,
            bilingualTargetLanguage: 'zh-CN',
        };
    }
    if (/英文字幕|英语字幕|english subtitle|en subtitle/i.test(normalized)) {
        return {
            targetLanguages: ['en'],
            defaultSubtitleLanguage: 'en',
            generateBilingualAss: true,
            bilingualTargetLanguage: 'en',
        };
    }
    return {
        defaultSubtitleLanguage: 'source',
        generateBilingualAss: false,
    };
}

function latestTask(tasks: TaskSummary[], predicate?: (task: TaskSummary) => boolean): TaskSummary | undefined {
    const filtered = predicate ? tasks.filter(predicate) : tasks;
    return filtered
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function parseTaskAgentIntent(command: string | undefined, prompt: string): TaskAgentIntent {
    const normalized = prompt.trim();
    const head = (command || normalized.split(/\s+/, 1)[0] || 'help').replace(/^\//, '').toLowerCase();
    const wantsDirectory = /目录|文件夹|所有视频|全部视频|(?:^|\s)(?:folder|directory)(?:\s|$)/i.test(normalized);

    if (head === 'list') {
        return { type: 'list' };
    }
    if (head === 'batches' || head === 'batch') {
        return { type: 'listBatches' };
    }
    if (head === 'get') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'get', taskId } : { type: 'help' };
    }
    if (head === 'result') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'result', taskId } : { type: 'help' };
    }
    if (head === 'pause') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'pause', taskId } : { type: 'help' };
    }
    if (head === 'resume') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'resume', taskId } : { type: 'help' };
    }
    if (head === 'retry') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'retry', taskId } : { type: 'help' };
    }
    if (head === 'delete') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'delete', taskId } : { type: 'help' };
    }
    if (head === 'enqueue') {
        if (wantsDirectory) {
            const directoryPath = extractDirectoryPath(normalized);
            return directoryPath ? { type: 'enqueueDirectory', directoryPath, autoStart: false, recursive: true, ...inferSubtitlePreference(normalized) } : { type: 'help' };
        }
        const videoPath = extractVideoPath(normalized);
        return videoPath ? { type: 'enqueue', videoPath, autoStart: false, ...inferSubtitlePreference(normalized) } : { type: 'help' };
    }
    if (head === 'run' || head === 'start') {
        if (wantsDirectory) {
            const directoryPath = extractDirectoryPath(normalized);
            return directoryPath ? { type: 'enqueueDirectory', directoryPath, autoStart: true, recursive: true, ...inferSubtitlePreference(normalized) } : { type: 'runPending' };
        }
        const videoPath = extractVideoPath(normalized);
        if (videoPath) {
            return { type: 'enqueue', videoPath, autoStart: true, ...inferSubtitlePreference(normalized) };
        }
        return { type: 'runPending' };
    }
    if (/run pending|start pending|继续执行|运行队列/i.test(normalized)) {
        return { type: 'runPending' };
    }
    if (/最近批次|这批|batch/i.test(normalized)) {
        return { type: 'latestBatch' };
    }
    if (/list|tasks?|队列|状态/i.test(normalized)) {
        return { type: 'list' };
    }
    return { type: 'help' };
}

export function inferTaskAgentIntent(
    prompt: string,
    tasks: TaskSummary[],
    fallbackIntent: TaskAgentIntent
): TaskAgentIntent {
    if (fallbackIntent.type !== 'help') {
        return fallbackIntent;
    }

    const normalized = prompt.trim();
    const wantsDirectory = /目录|文件夹|所有视频|全部视频|(?:^|\s)(?:folder|directory)(?:\s|$)/i.test(normalized);
    if (wantsDirectory) {
        const directoryPath = extractDirectoryPath(normalized);
        if (directoryPath) {
            return {
                type: 'enqueueDirectory',
                directoryPath,
                autoStart: !/enqueue|queue|只创建|入队|排队/i.test(normalized),
                recursive: /递归|所有子目录|recursive/i.test(normalized) || wantsDirectory,
                ...inferSubtitlePreference(normalized),
            };
        }
    }

    if (/\/|[A-Za-z]:\\/.test(normalized)) {
        const match = extractVideoPath(normalized);
        if (match) {
            if (/enqueue|queue|只创建|入队|排队/i.test(normalized)) {
                return { type: 'enqueue', videoPath: match, autoStart: false, ...inferSubtitlePreference(normalized) };
            }
            return { type: 'enqueue', videoPath: match, autoStart: true, ...inferSubtitlePreference(normalized) };
        }
    }
    if (/最近批次|这批|batch/i.test(normalized)) {
        return { type: 'latestBatch' };
    }
    if (/结果|输出|字幕文件|review/i.test(normalized)) {
        const completed = latestTask(tasks, (task) => task.status === 'completed') ?? latestTask(tasks);
        if (completed) {
            return { type: 'result', taskId: completed.id };
        }
    }
    if (/重试|retry/i.test(normalized)) {
        const failed = latestTask(tasks, (task) => task.status === 'failed');
        if (failed) {
            return { type: 'retry', taskId: failed.id };
        }
    }
    if (/恢复|继续|resume/i.test(normalized)) {
        const paused = latestTask(tasks, (task) => task.status === 'paused');
        if (paused) {
            return { type: 'resume', taskId: paused.id };
        }
        const queued = latestTask(tasks, (task) => task.status === 'queued');
        if (queued) {
            return { type: 'runPending' };
        }
    }
    if (/暂停|pause/i.test(normalized)) {
        const running = latestTask(tasks, (task) =>
            task.status === 'transcribing' || task.status === 'optimizing' || task.status === 'translating'
        );
        if (running) {
            return { type: 'pause', taskId: running.id };
        }
    }
    if (/删除|delete/i.test(normalized)) {
        const task = latestTask(tasks);
        if (task) {
            return { type: 'delete', taskId: task.id };
        }
    }
    if (/状态|进度|结果|详情|最新|最近|status/i.test(normalized)) {
        const task = latestTask(tasks);
        return task ? { type: 'get', taskId: task.id } : { type: 'list' };
    }
    if (/启动|开始|run pending|start pending|执行队列|运行队列/i.test(normalized)) {
        return { type: 'runPending' };
    }
    if (/任务|队列|list/i.test(normalized)) {
        return { type: 'list' };
    }
    return fallbackIntent;
}

export function buildTaskAgentWorkflow(intent: TaskAgentIntent, tasks: TaskSummary[]): TaskAgentWorkflow | undefined {
    switch (intent.type) {
        case 'list':
            return { steps: [{ toolName: TASK_AGENT_TOOLS.listTasks, input: {}, summary: '正在列出字幕任务' }] };
        case 'listBatches':
            return { steps: [{ toolName: TASK_AGENT_TOOLS.listBatches, input: {}, summary: '正在列出最近字幕批次' }] };
        case 'latestBatch':
            return { steps: [{ toolName: TASK_AGENT_TOOLS.getLatestBatch, input: {}, summary: '正在读取最近批次状态' }] };
        case 'get':
            return { steps: [{ toolName: TASK_AGENT_TOOLS.getTask, input: { taskId: intent.taskId }, summary: `正在读取任务 ${intent.taskId}` }] };
        case 'result':
            return {
                steps: [{ toolName: TASK_AGENT_TOOLS.summarizeTaskResult, input: { taskId: intent.taskId }, summary: `正在汇总任务 ${intent.taskId} 的输出结果` }],
            };
        case 'pause':
            return {
                steps: [{ toolName: TASK_AGENT_TOOLS.pauseTask, input: { taskId: intent.taskId }, summary: `正在暂停任务 ${intent.taskId}` }],
                inspectTaskAfterStep: 0,
                finalMessage: '任务已暂停。如需继续执行，可使用 `/resume`。',
            };
        case 'resume':
            return {
                steps: [
                    { toolName: TASK_AGENT_TOOLS.resumeTask, input: { taskId: intent.taskId }, summary: `正在恢复任务 ${intent.taskId}` },
                    { toolName: TASK_AGENT_TOOLS.runPending, input: {}, summary: '正在尝试启动后台队列' },
                ],
                inspectTaskAfterStep: 1,
                finalMessage: '任务已经恢复并重新交给后台队列。Whisper 长任务请稍后用 `/get` 或 `/list` 查看状态。',
            };
        case 'retry':
            return {
                steps: [
                    { toolName: TASK_AGENT_TOOLS.retryTask, input: { taskId: intent.taskId }, summary: `正在重试任务 ${intent.taskId}` },
                    { toolName: TASK_AGENT_TOOLS.runPending, input: {}, summary: '正在尝试启动后台队列' },
                ],
                inspectTaskAfterStep: 1,
                finalMessage: '失败任务已经重新入队。Whisper 长任务请稍后用 `/get` 或 `/list` 查看状态。',
            };
        case 'delete':
            return {
                steps: [{ toolName: TASK_AGENT_TOOLS.deleteTask, input: { taskId: intent.taskId }, summary: `正在删除任务 ${intent.taskId}` }],
                listTasksAfterExecution: true,
                finalMessage: '任务记录已删除，输出文件不会被删除。',
            };
        case 'enqueue':
            return {
                steps: [
                    { toolName: TASK_AGENT_TOOLS.enqueueTask, input: {
                        videoPath: intent.videoPath,
                        targetLanguages: intent.targetLanguages,
                        defaultSubtitleLanguage: intent.defaultSubtitleLanguage,
                        generateBilingualAss: intent.generateBilingualAss,
                        bilingualTargetLanguage: intent.bilingualTargetLanguage,
                    }, summary: `正在为 ${intent.videoPath} 创建后台任务` },
                    ...(intent.autoStart ? [{ toolName: TASK_AGENT_TOOLS.runPending, input: {}, summary: '正在尝试启动后台队列' }] : []),
                ],
                inspectTaskAfterStep: intent.autoStart ? 1 : 0,
                finalMessage: intent.autoStart
                    ? 'Whisper 转录可能耗时较长。任务已经交给后台调度器，请稍后用 `/get` 或 `/list` 查询状态。'
                    : '任务已创建。当前不会阻塞等待 Whisper 完成，需要时可再执行 `/run` 启动队列。',
            };
        case 'enqueueDirectory':
            return {
                steps: [
                    {
                        toolName: TASK_AGENT_TOOLS.scanDirectory,
                        input: { directoryPath: intent.directoryPath, recursive: intent.recursive, maxFiles: 100 },
                        summary: `正在扫描目录 ${intent.directoryPath} 中的视频文件`,
                        storeResultAs: 'scanDirectory',
                    },
                    {
                        toolName: TASK_AGENT_TOOLS.enqueueTasks,
                        buildInput: (state) => ({
                            inputs: (state.scanDirectory?.videos ?? []).map((videoPath) => ({ videoPath })),
                            targetLanguages: intent.targetLanguages,
                            defaultSubtitleLanguage: intent.defaultSubtitleLanguage,
                            generateBilingualAss: intent.generateBilingualAss,
                            bilingualTargetLanguage: intent.bilingualTargetLanguage,
                        }),
                        summary: '正在为目录中的视频批量创建后台任务',
                        storeResultAs: 'enqueueTasks',
                    },
                    ...(intent.autoStart ? [{ toolName: TASK_AGENT_TOOLS.runPending, input: {}, summary: '正在尝试启动后台队列' }] : []),
                ],
                listTasksAfterExecution: (state) => Boolean(state.enqueueTasks && state.enqueueTasks.length > 0),
                finalMessage: (state) => {
                    const warnings = state.scanDirectory?.warnings ?? [];
                    const candidateDirectoryPath = state.scanDirectory?.directoryPath;
                    const suggestedDirectoryPath = state.scanDirectory?.suggestedDirectoryPath;
                    const queuedTasks = state.enqueueTasks ?? [];
                    if (queuedTasks.length === 0) {
                        const candidateMessage = candidateDirectoryPath
                            ? `我识别到的目录候选是：\`${candidateDirectoryPath}\`。`
                            : '当前没有稳定识别出可用目录。';
                        const extra = suggestedDirectoryPath
                            ? `建议改扫：\`${suggestedDirectoryPath}\`。`
                            : '请确认目录路径是否正确；如果路径里包含空格或自然语言尾巴，建议直接给目录加引号后重试。';
                        return `当前没有创建任何任务。${candidateMessage} ${warnings.join('；') || '目录扫描结果为空。'} ${extra}`;
                    }

                    const batchId = queuedTasks[0]?.batchId;
                    const taskCount = queuedTasks.length;
                    const truncatedNotice = state.scanDirectory?.truncated ? ' 目录扫描已达到上限，结果可能被截断。' : '';
                    return intent.autoStart
                        ? `目录中的 ${taskCount} 个视频已批量入队${batchId ? `，批次 ID：\`${batchId}\`` : ''}，并已尝试启动后台队列。Whisper 长任务请稍后用 \`/batches\` 或 \`/list\` 查看整体状态。${truncatedNotice}`
                        : `目录中的 ${taskCount} 个视频已批量入队${batchId ? `，批次 ID：\`${batchId}\`` : ''}。当前不会阻塞等待 Whisper 完成，需要时可再执行 \`/run\` 启动队列。${truncatedNotice}`;
                },
            };
        case 'runPending': {
            const focusTask = latestTask(tasks, (task) =>
                task.status === 'queued' || task.status === 'paused' || task.status === 'failed'
            ) ?? latestTask(tasks);
            return {
                steps: [{ toolName: TASK_AGENT_TOOLS.runPending, input: {}, summary: '正在启动排队中的字幕任务' }],
                inspectTaskAfterStep: focusTask ? 0 : undefined,
                finalMessage: focusTask
                    ? '后台队列已触发。下面展示最近相关任务的当前状态。'
                    : '后台队列已触发。当前没有可聚焦的任务，稍后可用 `/list` 查看整体状态。',
            };
        }
        case 'help':
        default:
            return undefined;
    }
}

export function snapshotTaskAgentTasks(api: SubtitleFlowApi): TaskSummary[] {
    return api.listTasks();
}
