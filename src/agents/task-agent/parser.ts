/**
 * TaskAgent 的输入解析层。
 * 这里负责从自然语言中提取视频路径、目录路径和任务 ID。
 */
import * as fs from 'fs';
import { VIDEO_EXTENSIONS } from '../../constants';

const TASK_ID_RE = /task_[a-zA-Z0-9_]+/;
const PATH_START_RE = /(?:\/|[A-Za-z]:\\)/;
const VIDEO_PATH_RE = new RegExp(
    `((?:\\/|[A-Za-z]:\\\\)[\\s\\S]*\\.(?:${VIDEO_EXTENSIONS.join('|')})(?=$|\\s|["']))`,
    'i'
);
const DIRECTORY_PATH_RE = /((?:\/|[A-Za-z]:\\)[\s\S]*?)(?=$|\s(?:下|里|中的|内的|里面的)|["'])/i;
const DIRECTORY_STOP_MARKERS = [
    ' 这个目录',
    ' 该目录',
    ' 目录下',
    ' 目录里',
    ' 目录中的',
    ' 目录内',
    ' 下的所有视频',
    ' 里的所有视频',
    ' 中的所有视频',
    ' 的所有视频',
    ' 的视频',
    ' 生成字幕',
    ' 提供字幕',
    ' 做字幕',
    ' 加字幕',
];

function trimTrailingPathNoise(value: string): string {
    return value.trim().replace(/[)\]}>,，。；：!！?？]+$/u, '');
}

function trimByStopMarkers(value: string, stopMarkers: string[]): string {
    let endIndex = value.length;
    for (const marker of stopMarkers) {
        const index = value.indexOf(marker);
        if (index >= 0 && index < endIndex) {
            endIndex = index;
        }
    }
    return trimTrailingPathNoise(value.slice(0, endIndex));
}

function isVideoFilePath(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
        return false;
    }
    try {
        return fs.statSync(filePath).isFile()
            && VIDEO_EXTENSIONS.includes(filePath.split('.').pop()?.toLowerCase() ?? '');
    } catch {
        return false;
    }
}

function isDirectoryPath(directoryPath: string): boolean {
    if (!fs.existsSync(directoryPath)) {
        return false;
    }
    try {
        return fs.statSync(directoryPath).isDirectory();
    } catch {
        return false;
    }
}

function longestExistingPathPrefix(value: string, kind: 'file' | 'directory'): string | undefined {
    const normalized = trimTrailingPathNoise(value);
    const validator = kind === 'file' ? isVideoFilePath : isDirectoryPath;
    if (validator(normalized)) {
        return normalized;
    }

    for (let index = normalized.length - 1; index >= 0; index--) {
        if (!/\s/u.test(normalized[index])) {
            continue;
        }
        const candidate = trimTrailingPathNoise(normalized.slice(0, index));
        if (candidate && validator(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function resolveDirectoryCandidate(raw: string): string | undefined {
    const trimmed = trimTrailingPathNoise(raw);
    if (isDirectoryPath(trimmed)) {
        return trimmed;
    }

    const byMarker = trimByStopMarkers(trimmed, DIRECTORY_STOP_MARKERS);
    if (isDirectoryPath(byMarker)) {
        return byMarker;
    }

    return longestExistingPathPrefix(byMarker, 'directory')
        ?? longestExistingPathPrefix(trimmed, 'directory')
        ?? (byMarker || undefined);
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
        return resolveDirectoryCandidate(quoted);
    }

    const directoryPath = prompt.match(DIRECTORY_PATH_RE)?.[1];
    if (directoryPath) {
        return resolveDirectoryCandidate(directoryPath);
    }

    const startIndex = prompt.search(PATH_START_RE);
    if (startIndex >= 0) {
        return resolveDirectoryCandidate(prompt.slice(startIndex));
    }

    return undefined;
}

export function extractTaskId(prompt: string): string | undefined {
    return prompt.match(TASK_ID_RE)?.[0];
}
