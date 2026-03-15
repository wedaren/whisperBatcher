/**
 * 历史产物布局迁移服务。
 *
 * 设计约束：
 * 1. 只做旧格式 -> 新格式的单向迁移；
 * 2. 不重新执行任务，不生成新字幕内容；
 * 3. 目标文件已存在时直接跳过，绝不覆盖；
 * 4. 只迁移高确定性旧文件，并同步更新任务记录中的输出路径。
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildArtifactLayout } from './artifactLayout';
import { TaskStore } from '../taskStore';
import type { TaskRecord } from '../types';
import { Logger } from './logger';

export interface ArtifactMigrationFileRecord {
    from: string;
    to: string;
    status: 'migrated' | 'skipped' | 'conflict';
    reason?: string;
}

export interface ArtifactMigrationTaskReport {
    taskId: string;
    videoPath: string;
    outputDir: string;
    migrated: number;
    skipped: number;
    conflicted: number;
    files: ArtifactMigrationFileRecord[];
}

export interface ArtifactMigrationSummary {
    tasks: ArtifactMigrationTaskReport[];
    migrated: number;
    skipped: number;
    conflicted: number;
}

export class ArtifactMigrationService {
    constructor(
        private readonly taskStore: TaskStore,
        private readonly logger: Logger
    ) {}

    migrateAllTasks(): ArtifactMigrationSummary {
        return this.migrateTasks(this.taskStore.getAllTasks());
    }

    migrateTask(taskId: string): ArtifactMigrationTaskReport | undefined {
        const task = this.taskStore.getTask(taskId);
        if (!task) {
            return undefined;
        }
        return this.migrateOneTask(task);
    }

    private migrateTasks(tasks: TaskRecord[]): ArtifactMigrationSummary {
        const reports = tasks.map((task) => this.migrateOneTask(task));
        return {
            tasks: reports,
            migrated: reports.reduce((sum, item) => sum + item.migrated, 0),
            skipped: reports.reduce((sum, item) => sum + item.skipped, 0),
            conflicted: reports.reduce((sum, item) => sum + item.conflicted, 0),
        };
    }

    private migrateOneTask(task: TaskRecord): ArtifactMigrationTaskReport {
        const layout = buildArtifactLayout(task.videoPath, {
            outputDir: task.outputs.folder,
            whisperModel: task.config?.whisperModel,
            whisperLanguage: task.config?.whisperLanguage,
        });
        const outputDir = task.outputs.folder ?? layout.outputDir;
        const baseName = path.basename(task.videoPath, path.extname(task.videoPath));
        const videoDir = path.dirname(task.videoPath);
        const files: ArtifactMigrationFileRecord[] = [];

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        if (!fs.existsSync(layout.rawCacheDir)) {
            fs.mkdirSync(layout.rawCacheDir, { recursive: true });
        }

        // 迁移旧 raw 原始字幕到 cache，并同步主文件。
        let migratedRaw = false;
        const rawCandidates = this.collectExisting([
            task.outputs.raw,
            layout.legacyModelRawPath,
        ]);
        for (const rawPath of rawCandidates) {
            if (rawPath === layout.rawTranscriptPath || rawPath === layout.rawCachePath) {
                continue;
            }
            const result = this.moveIfPossible(rawPath, layout.rawCachePath);
            files.push(result);
            if (result.status === 'migrated' || fs.existsSync(layout.rawCachePath)) {
                this.copyIfMissingOrDifferent(layout.rawCachePath, layout.rawTranscriptPath);
                migratedRaw = true;
                break;
            }
        }
        if (!migratedRaw && fs.existsSync(layout.rawCachePath) && !fs.existsSync(layout.rawTranscriptPath)) {
            this.copyIfMissingOrDifferent(layout.rawCachePath, layout.rawTranscriptPath);
        }

        // 迁移旧优化字幕。
        const llmCandidates = this.collectExisting([
            task.outputs.llm,
            layout.legacyLlmPath,
            path.join(outputDir, `${baseName}.llm.srt`),
        ]);
        for (const llmPath of llmCandidates) {
            if (llmPath === layout.optimizedSubtitlePath) {
                continue;
            }
            const result = this.moveIfPossible(llmPath, layout.optimizedSubtitlePath);
            files.push(result);
            if (result.status === 'migrated' || fs.existsSync(layout.optimizedSubtitlePath)) {
                break;
            }
        }

        // 默认字幕文件是新布局的重要入口；旧任务没有时就从优化字幕同步一份。
        if (fs.existsSync(layout.optimizedSubtitlePath) && !fs.existsSync(layout.defaultSubtitlePath)) {
            this.copyIfMissingOrDifferent(layout.optimizedSubtitlePath, layout.defaultSubtitlePath);
            files.push({
                from: layout.optimizedSubtitlePath,
                to: layout.defaultSubtitlePath,
                status: 'migrated',
                reason: '从优化字幕同步默认字幕主文件',
            });
        }

        // 迁移旧翻译文件：仅处理任务记录里已有语言和视频同级高确定性旧命名。
        const translatedOutputs: Record<string, string> = {};
        for (const [lang, oldPath] of Object.entries(task.outputs.translated)) {
            const newPath = layout.translatedPath(lang);
            translatedOutputs[lang] = this.migrateTranslationCandidate(oldPath, newPath, files) ?? newPath;
        }
        for (const lang of task.config?.targetLanguages ?? []) {
            if (translatedOutputs[lang]) {
                continue;
            }
            const legacyTranslationPath = path.join(outputDir, `${baseName}.${lang}.srt`);
            const newPath = layout.translatedPath(lang);
            const migratedPath = this.migrateTranslationCandidate(legacyTranslationPath, newPath, files);
            if (migratedPath) {
                translatedOutputs[lang] = migratedPath;
            }
        }

        // 迁移旧日志和配置文件。
        const configCandidates = this.collectExisting([
            task.outputs.config,
            path.join(outputDir, `${baseName}.task.json`),
            path.join(videoDir, `${baseName}.task.json`),
        ]);
        for (const configPath of configCandidates) {
            if (configPath === layout.taskConfigPath) {
                continue;
            }
            const result = this.moveIfPossible(configPath, layout.taskConfigPath);
            files.push(result);
            if (result.status === 'migrated' || fs.existsSync(layout.taskConfigPath)) {
                break;
            }
        }

        const logCandidates = this.collectExisting([
            task.outputs.log,
            path.join(outputDir, `${baseName}.log`),
            path.join(outputDir, `${baseName}.task.log`),
            path.join(videoDir, `${baseName}.log`),
            path.join(videoDir, `${baseName}.task.log`),
        ]);
        for (const logPath of logCandidates) {
            if (logPath === layout.taskLogPath) {
                continue;
            }
            const result = this.moveIfPossible(logPath, layout.taskLogPath);
            files.push(result);
            if (result.status === 'migrated' || fs.existsSync(layout.taskLogPath)) {
                break;
            }
        }

        const updatedTranslated: Record<string, string> = {};
        for (const [lang, filePath] of Object.entries(translatedOutputs)) {
            if (fs.existsSync(filePath)) {
                updatedTranslated[lang] = filePath;
            }
        }

        this.taskStore.updateTask(task.id, {
            outputs: {
                ...task.outputs,
                folder: outputDir,
                raw: fs.existsSync(layout.rawTranscriptPath) ? layout.rawTranscriptPath : task.outputs.raw,
                llm: fs.existsSync(layout.optimizedSubtitlePath) ? layout.optimizedSubtitlePath : task.outputs.llm,
                finalSrt: fs.existsSync(layout.defaultSubtitlePath)
                    ? layout.defaultSubtitlePath
                    : task.outputs.finalSrt,
                config: fs.existsSync(layout.taskConfigPath) ? layout.taskConfigPath : task.outputs.config,
                log: fs.existsSync(layout.taskLogPath) ? layout.taskLogPath : task.outputs.log,
                translated: updatedTranslated,
            },
        });

        const report = this.buildTaskReport(task, outputDir, files);
        this.logger.info(
            `Artifact migration for ${task.id}: migrated=${report.migrated}, skipped=${report.skipped}, conflicted=${report.conflicted}`
        );
        return report;
    }

    private migrateTranslationCandidate(
        candidatePath: string | undefined,
        newPath: string,
        files: ArtifactMigrationFileRecord[]
    ): string | undefined {
        if (!candidatePath || !fs.existsSync(candidatePath)) {
            return fs.existsSync(newPath) ? newPath : undefined;
        }
        if (candidatePath === newPath) {
            return newPath;
        }
        const result = this.moveIfPossible(candidatePath, newPath);
        files.push(result);
        return fs.existsSync(newPath) ? newPath : undefined;
    }

    private buildTaskReport(
        task: TaskRecord,
        outputDir: string,
        files: ArtifactMigrationFileRecord[]
    ): ArtifactMigrationTaskReport {
        const migrated = files.filter((item) => item.status === 'migrated').length;
        const skipped = files.filter((item) => item.status === 'skipped').length;
        const conflicted = files.filter((item) => item.status === 'conflict').length;
        return {
            taskId: task.id,
            videoPath: task.videoPath,
            outputDir,
            migrated,
            skipped,
            conflicted,
            files,
        };
    }

    private collectExisting(values: Array<string | undefined>): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const value of values) {
            if (!value || seen.has(value) || !fs.existsSync(value)) {
                continue;
            }
            seen.add(value);
            result.push(value);
        }
        return result;
    }

    private moveIfPossible(fromPath: string, toPath: string): ArtifactMigrationFileRecord {
        if (!fs.existsSync(fromPath)) {
            return { from: fromPath, to: toPath, status: 'skipped', reason: '源文件不存在' };
        }
        if (fromPath === toPath) {
            return { from: fromPath, to: toPath, status: 'skipped', reason: '文件已是新命名' };
        }
        if (fs.existsSync(toPath)) {
            return { from: fromPath, to: toPath, status: 'conflict', reason: '目标文件已存在，跳过覆盖' };
        }

        const targetDir = path.dirname(toPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.renameSync(fromPath, toPath);
        return { from: fromPath, to: toPath, status: 'migrated' };
    }

    private copyIfMissingOrDifferent(sourcePath: string, targetPath: string): void {
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        if (fs.existsSync(targetPath)) {
            const sourceStat = fs.statSync(sourcePath);
            const targetStat = fs.statSync(targetPath);
            if (sourceStat.size === targetStat.size) {
                return;
            }
        }
        fs.copyFileSync(sourcePath, targetPath);
    }
}
