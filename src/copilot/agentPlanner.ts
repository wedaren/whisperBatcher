import type { ParticipantIntent } from './participantParser';
import type { TaskSummary } from '../publicApi';
import { extractVideoPath } from './participantParser';

function latestTask(tasks: TaskSummary[], predicate?: (task: TaskSummary) => boolean): TaskSummary | undefined {
    const filtered = predicate ? tasks.filter(predicate) : tasks;
    return filtered
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * 在没有显式 slash command 的情况下，根据自然语言和现有任务状态推断下一步动作。
 * 这里的目标不是做开放式对话，而是把高频运维式请求映射成稳定的任务控制动作。
 */
export function inferParticipantIntent(
    prompt: string,
    tasks: TaskSummary[],
    fallbackIntent: ParticipantIntent
): ParticipantIntent {
    if (fallbackIntent.type !== 'help') {
        return fallbackIntent;
    }

    const normalized = prompt.trim();

    if (/\/|[A-Za-z]:\\/.test(normalized)) {
        const match = extractVideoPath(normalized);
        if (match) {
            if (/enqueue|queue|只创建|入队|排队/i.test(normalized)) {
                return { type: 'enqueue', videoPath: match, autoStart: false };
            }
            return { type: 'enqueue', videoPath: match, autoStart: true };
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
        if (task) {
            return { type: 'get', taskId: task.id };
        }
        return { type: 'list' };
    }

    if (/启动|开始|run pending|start pending|执行队列|运行队列/i.test(normalized)) {
        return { type: 'runPending' };
    }

    if (/任务|队列|list/i.test(normalized)) {
        return { type: 'list' };
    }

    return fallbackIntent;
}
