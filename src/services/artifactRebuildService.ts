/**
 * 阶段重建服务。
 *
 * 目标：
 * 1. 用户显式要求重建时，先为将被覆盖的当前产物做快照备份；
 * 2. 再按阶段删除对应产物，让流水线从该阶段向后增量重建；
 * 3. 不改变输出目录模型，也不引入复杂版本系统。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { RebuildStage } from '../publicApi';
import type { TaskRecord, TaskOutputs } from '../types';
import { TaskStore } from '../taskStore';
import { Logger } from './logger';
import { buildArtifactLayout } from './artifactLayout';

export interface PreparedRebuild {
    backupDir?: string;
    removedPaths: string[];
    updatedOutputs: TaskOutputs;
}

export class ArtifactRebuildService {
    constructor(
        private readonly taskStore: TaskStore,
        private readonly logger: Logger
    ) {}

    prepare(taskId: string, stage: RebuildStage): PreparedRebuild | undefined {
        const task = this.taskStore.getTask(taskId);
        if (!task) {
            return undefined;
        }

        const layout = buildArtifactLayout(task.videoPath, {
            outputDir: task.outputs.folder,
            whisperModel: task.config?.whisperModel,
            whisperLanguage: task.config?.whisperLanguage,
        });
        const pathsToReset = this.collectPathsForStage(task, stage, layout);
        const existingPaths = pathsToReset.filter((filePath) => fs.existsSync(filePath));
        const backupDir = existingPaths.length > 0 ? this.createBackup(task, stage, existingPaths, layout.backupRoot) : undefined;

        const removedPaths: string[] = [];
        for (const filePath of existingPaths) {
            try {
                fs.rmSync(filePath, { recursive: true, force: true });
                removedPaths.push(filePath);
            } catch (error: any) {
                this.logger.warn(`重建阶段清理失败：${filePath} -> ${error.message || String(error)}`);
            }
        }

        const updatedOutputs = this.buildUpdatedOutputs(task.outputs, stage, layout);
        this.taskStore.updateTask(task.id, {
            outputs: updatedOutputs,
            status: 'queued',
            currentPhase: 'queued',
            lastError: undefined,
        });

        this.logger.info(
            `Prepared rebuild for ${task.id} from ${stage}: removed=${removedPaths.length}, backup=${backupDir ?? 'none'}`
        );
        return {
            backupDir,
            removedPaths,
            updatedOutputs,
        };
    }

    private createBackup(task: TaskRecord, stage: RebuildStage, paths: string[], backupRoot: string): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(backupRoot, `${timestamp}-${stage}`);
        fs.mkdirSync(backupDir, { recursive: true });

        for (const sourcePath of paths) {
            const relativePath = this.buildBackupRelativePath(task, sourcePath);
            const targetPath = path.join(backupDir, relativePath);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
        }

        return backupDir;
    }

    private buildBackupRelativePath(task: TaskRecord, sourcePath: string): string {
        const outputDir = task.outputs.folder ?? buildArtifactLayout(task.videoPath).outputDir;
        if (sourcePath.startsWith(outputDir + path.sep) || sourcePath === outputDir) {
            return path.relative(outputDir, sourcePath);
        }
        return path.join('external', path.basename(sourcePath));
    }

    private collectPathsForStage(task: TaskRecord, stage: RebuildStage, layout: ReturnType<typeof buildArtifactLayout>): string[] {
        const translatedPaths = Object.values(task.outputs.translated ?? {});
        const reviewPaths = [layout.reviewSummaryPath, layout.manualReviewPath, layout.lexiconCandidatesPath];

        if (stage === 'translate') {
            return [...translatedPaths, ...reviewPaths];
        }

        if (stage === 'optimize') {
            return [
                layout.optimizedSubtitlePath,
                layout.defaultSubtitlePath,
                ...translatedPaths,
                ...reviewPaths,
            ];
        }

        return [
            layout.rawTranscriptPath,
            layout.rawCachePath,
            layout.optimizedSubtitlePath,
            layout.defaultSubtitlePath,
            ...translatedPaths,
            ...reviewPaths,
        ];
    }

    private buildUpdatedOutputs(outputs: TaskOutputs, stage: RebuildStage, layout: ReturnType<typeof buildArtifactLayout>): TaskOutputs {
        if (stage === 'translate') {
            return {
                ...outputs,
                translated: {},
            };
        }

        if (stage === 'optimize') {
            return {
                ...outputs,
                llm: undefined,
                finalSrt: undefined,
                translated: {},
            };
        }

        return {
            ...outputs,
            raw: undefined,
            llm: undefined,
            finalSrt: undefined,
            translated: {},
        };
    }
}
