/**
 * 统一管理字幕任务产物的目录结构与文件命名。
 *
 * 设计目标：
 * 1. 用户可见主文件名语义化，便于排序和理解；
 * 2. Whisper 原始转录支持按模型/语言缓存复用；
 * 3. 保持视频同名输出目录不变，不把批次或 taskId 混入目录结构。
 */
import * as path from 'path';
import { OUTPUT_FOLDER_SUFFIX } from '../constants';

export const ARTIFACT_NAMES = {
    rawTranscript: '01-raw-transcript.srt',
    optimizedSubtitle: '02-optimized-subtitle.srt',
    defaultSubtitle: '03-default-subtitle.srt',
    translationPrefix: '04-translation',
    bilingualAssPrefix: '05-bilingual',
    taskConfig: 'task-config.json',
    taskLog: 'task-log.txt',
    recoverySummary: 'recovery-summary.md',
    manualReview: 'manual-review.json',
    lexiconCandidates: 'lexicon-candidates.json',
} as const;

export function sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function resolveTaskOutputDir(videoPath: string, suffix: string = OUTPUT_FOLDER_SUFFIX): string {
    const videoDir = path.dirname(videoPath);
    const baseName = path.basename(videoPath, path.extname(videoPath));
    return path.join(videoDir, `${baseName}${suffix}`);
}

export function buildArtifactLayout(videoPath: string, options?: { outputDir?: string; whisperModel?: string; whisperLanguage?: string }) {
    const baseName = path.basename(videoPath, path.extname(videoPath));
    const outputDir = options?.outputDir ?? resolveTaskOutputDir(videoPath);
    const cacheRoot = path.join(outputDir, 'cache');
    const rawCacheDir = path.join(cacheRoot, 'raw');
    const modelSafe = sanitizeSegment(options?.whisperModel ?? 'tiny');
    const languageSafe = sanitizeSegment(options?.whisperLanguage ?? 'auto');

    return {
        outputDir,
        cacheRoot,
        rawCacheDir,
        backupRoot: path.join(outputDir, 'backups'),
        taskConfigPath: path.join(outputDir, ARTIFACT_NAMES.taskConfig),
        taskLogPath: path.join(outputDir, ARTIFACT_NAMES.taskLog),
        rawTranscriptPath: path.join(outputDir, ARTIFACT_NAMES.rawTranscript),
        rawCachePath: path.join(rawCacheDir, `whisper-${modelSafe}.${languageSafe}.srt`),
        optimizedSubtitlePath: path.join(outputDir, ARTIFACT_NAMES.optimizedSubtitle),
        defaultSubtitlePath: path.join(outputDir, ARTIFACT_NAMES.defaultSubtitle),
        translatedPath: (lang: string) => path.join(outputDir, `${ARTIFACT_NAMES.translationPrefix}.${lang}.srt`),
        bilingualAssPath: (lang: string) => path.join(outputDir, `${ARTIFACT_NAMES.bilingualAssPrefix}.${lang}.ass`),
        videoCompanionSubtitlePath: path.join(path.dirname(videoPath), `${baseName}.srt`),
        reviewSummaryPath: path.join(outputDir, ARTIFACT_NAMES.recoverySummary),
        manualReviewPath: path.join(outputDir, ARTIFACT_NAMES.manualReview),
        lexiconCandidatesPath: path.join(outputDir, ARTIFACT_NAMES.lexiconCandidates),
        legacyModelRawPath: path.join(path.dirname(videoPath), `${baseName}.${modelSafe}.raw.srt`),
        legacyLlmPath: path.join(path.dirname(videoPath), `${baseName}.llm.srt`),
    };
}
