/**
 * participant 只做轻量意图解析。
 * 真正执行统一交给 Copilot tools，再由 tools 转发到公共 API。
 */
import { VIDEO_EXTENSIONS } from '../constants';

export type ParticipantIntent =
    | { type: 'help' }
    | { type: 'list' }
    | { type: 'get'; taskId: string }
    | { type: 'pause'; taskId: string }
    | { type: 'resume'; taskId: string }
    | { type: 'retry'; taskId: string }
    | { type: 'delete'; taskId: string }
    | { type: 'enqueue'; videoPath: string; autoStart: boolean }
    | { type: 'runPending' };

const TASK_ID_RE = /task_[a-zA-Z0-9_]+/;
const PATH_START_RE = /(?:\/|[A-Za-z]:\\)/;
const VIDEO_PATH_RE = new RegExp(
    `((?:\\/|[A-Za-z]:\\\\)[\\s\\S]*\\.(?:${VIDEO_EXTENSIONS.join('|')})(?=$|\\s|["']))`,
    'i'
);

function trimTrailingPathNoise(value: string): string {
    return value.trim().replace(/[)\]}>,，。；：!！?？]+$/u, '');
}

export function extractVideoPath(prompt: string): string | undefined {
    const quoted = prompt.match(/"([^"]+)"/)?.[1] ?? prompt.match(/'([^']+)'/)?.[1];
    if (quoted) {
        return trimTrailingPathNoise(quoted);
    }

    const fullVideoPath = prompt.match(VIDEO_PATH_RE)?.[1];
    if (fullVideoPath) {
        return trimTrailingPathNoise(fullVideoPath);
    }

    const startIndex = prompt.search(PATH_START_RE);
    if (startIndex >= 0) {
        return trimTrailingPathNoise(prompt.slice(startIndex));
    }

    return undefined;
}

function extractTaskId(prompt: string): string | undefined {
    return prompt.match(TASK_ID_RE)?.[0];
}

export function parseParticipantIntent(command: string | undefined, prompt: string): ParticipantIntent {
    const normalized = prompt.trim();
    const head = (command || normalized.split(/\s+/, 1)[0] || 'help').replace(/^\//, '').toLowerCase();

    if (head === 'list') {
        return { type: 'list' };
    }

    if (head === 'get') {
        const taskId = extractTaskId(normalized);
        return taskId ? { type: 'get', taskId } : { type: 'help' };
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
        const videoPath = extractVideoPath(normalized);
        return videoPath ? { type: 'enqueue', videoPath, autoStart: false } : { type: 'help' };
    }

    if (head === 'run' || head === 'start') {
        const videoPath = extractVideoPath(normalized);
        if (videoPath) {
            return { type: 'enqueue', videoPath, autoStart: true };
        }
        return { type: 'runPending' };
    }

    if (/run pending|start pending|继续执行|运行队列/i.test(normalized)) {
        return { type: 'runPending' };
    }

    if (/list|tasks?|队列|状态/i.test(normalized)) {
        return { type: 'list' };
    }

    return { type: 'help' };
}

export function renderParticipantHelp(): string {
    return [
        '`@subtitleFlow` 通过后台任务方式运行字幕流程，适合处理耗时较长的 Whisper 转录。',
        '',
        '推荐命令：',
        '- `/list`',
        '- `/enqueue "/absolute/path/video.mp4"`',
        '- `/run "/absolute/path/video.mp4"`',
        '- `/run` 或 `run pending`',
        '- `/get task_123456_abcdef`',
        '- `/pause task_123456_abcdef`',
        '- `/resume task_123456_abcdef`',
        '- `/retry task_123456_abcdef`',
        '- `/delete task_123456_abcdef`',
        '',
        '说明：',
        '- `/enqueue` 只创建任务，不等待 Whisper 完成',
        '- `/run` 会创建任务并尝试启动后台队列',
        '- 长任务请用 `/get` 或 `/list` 轮询状态',
    ].join('\n');
}
