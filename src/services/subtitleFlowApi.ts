import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as vscode from 'vscode';
import { OUTPUT_FOLDER_SUFFIX, VIDEO_EXTENSIONS } from '../constants';
import type { TaskRecord } from '../types';
import { TaskStore } from '../taskStore';
import { PipelineRunner } from './pipelineRunner';
import { WhisperService } from './whisperService';
import { OptimizeService } from './optimizeService';
import { TranslateService } from './translateService';
import { ComplianceService } from './complianceService';
import { TaskScheduler } from './taskScheduler';
import { Logger } from './logger';
import { resolveTaskOutputDir } from './artifactLayout';
import {
    type BatchSummary,
    type EnqueueTaskInput,
    type EnqueueTaskOptions,
    type OptimizeOptions,
    type OptimizeResult,
    type PipelineResult,
    type RunPipelineOptions,
    type ScanDirectoryOptions,
    type ScanDirectoryResult,
    type SubtitleFlowApi,
    type TaskResultSummary,
    type TaskSummary,
    type TranscribeOptions,
    type TranscribeResult,
    type TranslateOptions,
    type TranslateResult,
    toTaskSummary,
} from '../publicApi';

/**
 * Subtitle Flow 对外门面实现。
 * 这一层把任务存储、调度器、流水线和单步服务收敛成稳定接口，
 * 让命令、Copilot tools 和未来外部扩展共享同一套控制面。
 */
export class SubtitleFlowApiService implements SubtitleFlowApi {
    constructor(
        private readonly taskStore: TaskStore,
        private readonly scheduler: TaskScheduler,
        private readonly pipelineRunner: PipelineRunner,
        private readonly whisper: WhisperService,
        private readonly optimizeService: OptimizeService,
        private readonly translateService: TranslateService,
        private readonly complianceService: ComplianceService,
        private readonly logger: Logger,
        private readonly extensionPath: string
    ) {}

    async enqueueTask(input: EnqueueTaskInput, options?: EnqueueTaskOptions): Promise<TaskSummary> {
        const task = await this.createTask(input.videoPath, options, 'queued');
        this.scheduler.enqueue(task.id);
        return toTaskSummary(task);
    }

    async enqueueTasks(inputs: EnqueueTaskInput[], options?: EnqueueTaskOptions): Promise<TaskSummary[]> {
        const batchId = this.taskStore.generateBatchId();
        const tasks: TaskSummary[] = [];
        for (const input of inputs) {
            const task = await this.createTask(input.videoPath, options, 'queued', batchId);
            this.scheduler.enqueue(task.id);
            tasks.push(toTaskSummary(task));
        }
        return tasks;
    }

    async scanDirectory(directoryPath: string, options?: ScanDirectoryOptions): Promise<ScanDirectoryResult> {
        const maxFiles = Math.max(1, options?.maxFiles ?? 100);
        const videos: string[] = [];
        const recursive = options?.recursive ?? false;
        const warnings: string[] = [];

        try {
            const stat = await fs.stat(directoryPath);
            if (!stat.isDirectory()) {
                return {
                    directoryPath,
                    videos: [],
                    truncated: false,
                    warnings: [`目标路径不是目录：${directoryPath}`],
                };
            }
        } catch {
            return {
                directoryPath,
                videos: [],
                truncated: false,
                warnings: [`目录不存在或无法访问：${directoryPath}`],
            };
        }

        const walk = async (currentPath: string): Promise<void> => {
            const entries = await fs.readdir(currentPath, { withFileTypes: true });
            for (const entry of entries) {
                if (videos.length >= maxFiles) {
                    return;
                }
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    if (recursive) {
                        await walk(fullPath);
                    }
                    continue;
                }
                if (entry.isFile() && VIDEO_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase())) {
                    videos.push(fullPath);
                }
            }
        };

        await walk(directoryPath);
        let suggestedDirectoryPath: string | undefined;
        if (videos.length === 0) {
            const splitsDir = path.join(directoryPath, 'splits');
            try {
                const splitEntries = await fs.readdir(splitsDir, { withFileTypes: true });
                const hasVideo = splitEntries.some((entry) =>
                    entry.isFile() && VIDEO_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase())
                );
                if (hasVideo) {
                    suggestedDirectoryPath = splitsDir;
                    warnings.push(`当前目录没有直接命中的视频文件，可优先尝试子目录：${splitsDir}`);
                }
            } catch {
                // splits 目录不存在时忽略建议。
            }
            if (warnings.length === 0) {
                warnings.push(`目录中未发现可处理的视频文件：${directoryPath}`);
            }
        }
        return {
            directoryPath,
            videos,
            truncated: videos.length >= maxFiles,
            warnings,
            suggestedDirectoryPath,
        };
    }

    runPending(): void {
        this.scheduler.runPending();
    }

    getTask(taskId: string): TaskSummary | undefined {
        const task = this.taskStore.getTask(taskId);
        return task ? toTaskSummary(task) : undefined;
    }

    listTasks(): TaskSummary[] {
        return this.taskStore.getAllTasks()
            .slice()
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map(toTaskSummary);
    }

    getBatch(batchId: string): BatchSummary | undefined {
        const tasks = this.taskStore.getAllTasks().filter((task) => task.batchId === batchId);
        return tasks.length > 0 ? this.toBatchSummary(batchId, tasks) : undefined;
    }

    getLatestBatch(): BatchSummary | undefined {
        return this.listBatches()[0];
    }

    listBatches(): BatchSummary[] {
        const groups = new Map<string, TaskRecord[]>();
        for (const task of this.taskStore.getAllTasks()) {
            if (!task.batchId) {
                continue;
            }
            const bucket = groups.get(task.batchId) ?? [];
            bucket.push(task);
            groups.set(task.batchId, bucket);
        }

        return Array.from(groups.entries())
            .map(([batchId, tasks]) => this.toBatchSummary(batchId, tasks))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    summarizeTaskResult(taskId: string): TaskResultSummary | undefined {
        const task = this.taskStore.getTask(taskId);
        if (!task) {
            return undefined;
        }

        const outputFolder = task.outputs.folder;
        const manualReviewPath = outputFolder ? path.join(outputFolder, 'manual-review.json') : undefined;
        const lexiconCandidatesPath = outputFolder ? path.join(outputFolder, 'lexicon-candidates.json') : undefined;
        const recoverySummaryPath = outputFolder ? path.join(outputFolder, 'recovery-summary.md') : undefined;

        const review = {
            hasManualReview: manualReviewPath ? this.fileExists(manualReviewPath) : false,
            manualReviewPath,
            hasLexiconCandidates: lexiconCandidatesPath ? this.fileExists(lexiconCandidatesPath) : false,
            lexiconCandidatesPath,
            hasRecoverySummary: recoverySummaryPath ? this.fileExists(recoverySummaryPath) : false,
            recoverySummaryPath,
        };

        return {
            taskId: task.id,
            batchId: task.batchId,
            status: task.status,
            currentPhase: task.currentPhase,
            videoPath: task.videoPath,
            outputFolder,
            defaultSubtitlePath: task.outputs.finalSrt,
            optimizedSubtitlePath: task.outputs.llm,
            rawSubtitlePath: task.outputs.raw,
            translatedPaths: { ...task.outputs.translated },
            logPath: task.outputs.log,
            configPath: task.outputs.config,
            review,
            message: this.buildTaskResultMessage(task, review),
        };
    }

    cleanStaleTasks(): number {
        const count = this.taskStore.cleanStaleTasks();
        this.taskStore.refreshOutputStatus();
        return count;
    }

    pauseTask(taskId: string): void {
        this.scheduler.pause(taskId);
    }

    resumeTask(taskId: string): void {
        this.scheduler.resume(taskId);
    }

    retryTask(taskId: string): void {
        this.scheduler.retry(taskId);
    }

    deleteTask(taskId: string): boolean {
        if (this.scheduler.isRunning(taskId)) {
            this.scheduler.pause(taskId);
        }
        return this.taskStore.removeTask(taskId);
    }

    onDidChangeTasks(listener: (tasks: TaskSummary[]) => void): vscode.Disposable {
        return this.taskStore.onDidChange(() => listener(this.listTasks()));
    }

    async transcribe(videoPath: string, options?: TranscribeOptions): Promise<TranscribeResult> {
        const rawSrtPath = await this.whisper.transcribe(videoPath, options);
        return { rawSrtPath };
    }

    async optimize(rawSrtPath: string, options?: OptimizeOptions): Promise<OptimizeResult> {
        this.loadComplianceRules(options?.logFn);
        return this.optimizeService.optimize(rawSrtPath, options);
    }

    async translate(llmSrtPath: string, targetLanguages: string[], options?: TranslateOptions): Promise<TranslateResult> {
        this.loadComplianceRules(options?.logFn);
        const result = await this.translateService.translateAll(llmSrtPath, targetLanguages, options);
        return {
            translatedPaths: result.paths,
            totalComplianceHits: result.totalComplianceHits,
        };
    }

    async runPipeline(videoPath: string, options?: RunPipelineOptions): Promise<PipelineResult> {
        const task = await this.createTask(videoPath, options, 'direct');
        const abortController = new AbortController();

        if (options?.signal) {
            options.signal.addEventListener('abort', () => abortController.abort());
            if (options.signal.aborted) {
                abortController.abort();
            }
        }

        await this.pipelineRunner.run(task.id, abortController);
        const updated = this.taskStore.getTask(task.id);
        if (!updated) {
            throw new Error(`Task ${task.id} disappeared after pipeline execution`);
        }

        return { task: toTaskSummary(updated) };
    }

    private async createTask(
        videoPath: string,
        options: EnqueueTaskOptions | undefined,
        mode: 'queued' | 'direct',
        batchId?: string
    ): Promise<TaskRecord> {
        const task = this.taskStore.addTask(videoPath, options, { batchId });
        const taskOutputDir = this.resolveTaskOutputDir(videoPath);

        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(taskOutputDir));
        } catch {
            // 目录已存在或并发创建失败时忽略即可。
        }

        const { configFilePath, logFilePath } = this.logger.createTaskLog(videoPath, task.id, taskOutputDir);
        const updated = this.taskStore.updateTask(task.id, {
            outputs: {
                ...task.outputs,
                config: configFilePath,
                log: logFilePath,
                folder: taskOutputDir,
            },
        });

        const logFn = this.logger.createTaskLogFn(videoPath, task.id, taskOutputDir);
        logFn(mode === 'queued' ? 'Task created and added to queue' : 'Task created for direct pipeline execution');
        logFn(`Video: ${videoPath}`);
        if (options?.whisperModel || options?.whisperLanguage || options?.targetLanguages) {
            logFn(
                `Task Config: model=${options.whisperModel || 'global'}, lang=${options.whisperLanguage || 'global'}, langs=[${options.targetLanguages?.join(',') || 'global'}]`
            );
        }

        return updated ?? task;
    }

    private toBatchSummary(batchId: string, tasks: TaskRecord[]): BatchSummary {
        const createdAt = tasks
            .map((task) => task.createdAt)
            .slice()
            .sort((left, right) => left.localeCompare(right))[0];
        const updatedAt = tasks
            .map((task) => task.updatedAt)
            .slice()
            .sort((left, right) => right.localeCompare(left))[0];
        const runningCount = tasks.filter((task) => ['transcribing', 'optimizing', 'translating'].includes(task.status)).length;

        return {
            id: batchId,
            createdAt,
            updatedAt,
            taskIds: tasks.map((task) => task.id),
            videoPaths: tasks.map((task) => task.videoPath),
            counts: {
                total: tasks.length,
                queued: tasks.filter((task) => task.status === 'queued').length,
                running: runningCount,
                completed: tasks.filter((task) => task.status === 'completed').length,
                failed: tasks.filter((task) => task.status === 'failed').length,
                paused: tasks.filter((task) => task.status === 'paused').length,
            },
        };
    }

    private buildTaskResultMessage(
        task: TaskRecord,
        review: {
            hasManualReview: boolean;
            hasLexiconCandidates: boolean;
            hasRecoverySummary: boolean;
        }
    ): string {
        if (task.status !== 'completed') {
            return `任务尚未完成，当前阶段为 ${task.currentPhase}。`;
        }

        const translatedCount = Object.keys(task.outputs.translated).length;
        const reviewHints: string[] = [];
        if (review.hasManualReview) {
            reviewHints.push('存在人工复核记录');
        }
        if (review.hasLexiconCandidates) {
            reviewHints.push('存在词典候选');
        }

        return [
            task.outputs.finalSrt ? '默认字幕已生成。' : '默认字幕尚未生成。',
            translatedCount > 0 ? `翻译字幕 ${translatedCount} 份。` : '当前没有翻译字幕输出。',
            reviewHints.length > 0 ? `附加信息：${reviewHints.join('，')}。` : '当前没有额外复核工件。',
        ].join(' ');
    }

    private fileExists(filePath: string): boolean {
        try {
            return fsSync.existsSync(filePath);
        } catch {
            return false;
        }
    }

    private resolveTaskOutputDir(videoPath: string): string {
        const suffix = vscode.workspace.getConfiguration('subtitleFlow').get<string>('outputFolderSuffix', OUTPUT_FOLDER_SUFFIX);
        return resolveTaskOutputDir(videoPath, suffix);
    }

    private loadComplianceRules(logFn?: (msg: string) => void): void {
        let rulesPath = vscode.workspace.getConfiguration('subtitleFlow').get<string>('complianceRulesPath', '');
        if (!rulesPath) {
            rulesPath = path.join(this.extensionPath, 'resources', 'default-lexicon.yml');
        }

        this.complianceService.loadRules(rulesPath);
        if (logFn) {
            logFn(
                this.complianceService.isLoaded
                    ? `Compliance lexicon loaded: ${rulesPath}`
                    : `Compliance lexicon unavailable, continuing without rules: ${rulesPath}`
            );
        }
    }
}
