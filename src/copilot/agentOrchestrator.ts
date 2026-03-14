import type { SubtitleFlowApi, TaskSummary } from '../publicApi';
import type { ParticipantIntent } from './participantParser';
import { SUBTITLE_FLOW_TOOL_NAMES } from './toolNames';

export interface AgentStep {
    toolName: string;
    input: Record<string, unknown>;
    summary: string;
}

export interface AgentWorkflow {
    steps: AgentStep[];
    inspectTaskAfterStep?: number;
    listTasksAfterExecution?: boolean;
    finalMessage?: string;
}

function latestTask(tasks: TaskSummary[], predicate?: (task: TaskSummary) => boolean): TaskSummary | undefined {
    const filtered = predicate ? tasks.filter(predicate) : tasks;
    return filtered
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * 根据当前意图和任务状态构建多步工具链。
 * 这一层把 participant 从“命令路由器”提升为“任务感知编排器”。
 */
export function buildAgentWorkflow(intent: ParticipantIntent, tasks: TaskSummary[]): AgentWorkflow | undefined {
    switch (intent.type) {
        case 'list':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.listTasks,
                        input: {},
                        summary: '正在列出字幕任务',
                    },
                ],
            };
        case 'get':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.getTask,
                        input: { taskId: intent.taskId },
                        summary: `正在读取任务 ${intent.taskId}`,
                    },
                ],
            };
        case 'pause':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.pauseTask,
                        input: { taskId: intent.taskId },
                        summary: `正在暂停任务 ${intent.taskId}`,
                    },
                ],
                inspectTaskAfterStep: 0,
                finalMessage: '任务已暂停。如需继续执行，可使用 `/resume`。',
            };
        case 'resume':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.resumeTask,
                        input: { taskId: intent.taskId },
                        summary: `正在恢复任务 ${intent.taskId}`,
                    },
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.runPending,
                        input: {},
                        summary: '正在尝试启动后台队列',
                    },
                ],
                inspectTaskAfterStep: 1,
                finalMessage: '任务已经恢复并重新交给后台队列。Whisper 长任务请稍后用 `/get` 或 `/list` 查看状态。',
            };
        case 'retry':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.retryTask,
                        input: { taskId: intent.taskId },
                        summary: `正在重试任务 ${intent.taskId}`,
                    },
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.runPending,
                        input: {},
                        summary: '正在尝试启动后台队列',
                    },
                ],
                inspectTaskAfterStep: 1,
                finalMessage: '失败任务已经重新入队。Whisper 长任务请稍后用 `/get` 或 `/list` 查看状态。',
            };
        case 'delete':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.deleteTask,
                        input: { taskId: intent.taskId },
                        summary: `正在删除任务 ${intent.taskId}`,
                    },
                ],
                listTasksAfterExecution: true,
                finalMessage: '任务记录已删除，输出文件不会被删除。',
            };
        case 'enqueue':
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.enqueueTask,
                        input: { videoPath: intent.videoPath },
                        summary: `正在为 ${intent.videoPath} 创建后台任务`,
                    },
                    ...(intent.autoStart
                        ? [{
                            toolName: SUBTITLE_FLOW_TOOL_NAMES.runPending,
                            input: {},
                            summary: '正在尝试启动后台队列',
                        }]
                        : []),
                ],
                inspectTaskAfterStep: intent.autoStart ? 1 : 0,
                finalMessage: intent.autoStart
                    ? 'Whisper 转录可能耗时较长。任务已经交给后台调度器，请稍后用 `/get` 或 `/list` 查询状态。'
                    : '任务已创建。当前不会阻塞等待 Whisper 完成，需要时可再执行 `/run` 启动队列。',
            };
        case 'runPending': {
            const focusTask = latestTask(tasks, (task) =>
                task.status === 'queued' || task.status === 'paused' || task.status === 'failed'
            ) ?? latestTask(tasks);
            return {
                steps: [
                    {
                        toolName: SUBTITLE_FLOW_TOOL_NAMES.runPending,
                        input: {},
                        summary: '正在启动排队中的字幕任务',
                    },
                ],
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

/**
 * 在 participant 编排阶段读取一份最新任务快照。
 * 当前仍直接使用公共 API，而不是再次走工具，避免无意义的工具回环。
 */
export function snapshotTasks(api: SubtitleFlowApi): TaskSummary[] {
    return api.listTasks();
}
