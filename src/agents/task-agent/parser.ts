/**
 * TaskAgent 的输入解析层。
 * 这里负责从自然语言中提取视频路径、目录路径和任务 ID。
 */
import { VIDEO_EXTENSIONS } from '../../constants';

const TASK_ID_RE = /task_[a-zA-Z0-9_]+/;
const PATH_START_RE = /(?:\/|[A-Za-z]:\\)/;
const VIDEO_PATH_RE = new RegExp(
    `((?:\\/|[A-Za-z]:\\\\)[\\s\\S]*\\.(?:${VIDEO_EXTENSIONS.join('|')})(?=$|\\s|["']))`,
    'i'
);
const DIRECTORY_PATH_RE = /((?:\/|[A-Za-z]:\\)[\s\S]*?)(?=$|\s(?:下|里|中的|内的|里面的)|["'])/i;

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

export function extractDirectoryPath(prompt: string): string | undefined {
    const quoted = prompt.match(/目录\s*"([^"]+)"/)?.[1]
        ?? prompt.match(/目录\s*'([^']+)'/)?.[1]
        ?? prompt.match(/"([^"]+)"/)?.[1]
        ?? prompt.match(/'([^']+)'/)?.[1];
    if (quoted) {
        return trimTrailingPathNoise(quoted);
    }

    const directoryPath = prompt.match(DIRECTORY_PATH_RE)?.[1];
    if (directoryPath) {
        return trimTrailingPathNoise(directoryPath);
    }

    const startIndex = prompt.search(PATH_START_RE);
    if (startIndex >= 0) {
        return trimTrailingPathNoise(prompt.slice(startIndex));
    }

    return undefined;
}

export function extractTaskId(prompt: string): string | undefined {
    return prompt.match(TASK_ID_RE)?.[0];
}
