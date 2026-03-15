import * as path from 'path';
import * as fs from 'fs/promises';
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
import {
    type EnqueueTaskInput,
    type EnqueueTaskOptions,
    type OptimizeOptions,
    type OptimizeResult,
    type PipelineResult,
    type RunPipelineOptions,
    type ScanDirectoryOptions,
    type ScanDirectoryResult,
    type SubtitleFlowApi,
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
        const tasks: TaskSummary[] = [];
        for (const input of inputs) {
            tasks.push(await this.enqueueTask(input, options));
        }
        return tasks;
    }

    async scanDirectory(directoryPath: string, options?: ScanDirectoryOptions): Promise<ScanDirectoryResult> {
        const maxFiles = Math.max(1, options?.maxFiles ?? 100);
        const videos: string[] = [];
        const recursive = options?.recursive ?? false;

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
        return {
            directoryPath,
            videos,
            truncated: videos.length >= maxFiles,
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
        return this.taskStore.getAllTasks().map(toTaskSummary);
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
        mode: 'queued' | 'direct'
    ): Promise<TaskRecord> {
        const task = this.taskStore.addTask(videoPath, options);
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

    private resolveTaskOutputDir(videoPath: string): string {
        const suffix = vscode.workspace.getConfiguration('subtitleFlow').get<string>('outputFolderSuffix', OUTPUT_FOLDER_SUFFIX);
        const videoDir = path.dirname(videoPath);
        const baseName = path.basename(videoPath, path.extname(videoPath));
        return path.join(videoDir, `${baseName}${suffix}`);
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
