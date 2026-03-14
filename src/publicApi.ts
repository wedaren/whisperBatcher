import type * as vscode from 'vscode';
import type { TaskConfig, TaskOutputs, TaskPhase, TaskRecord } from './types';

/**
 * 对外公开的任务状态类型。
 * 这里直接复用内部 TaskPhase，避免维护额外映射。
 */
export type TaskStatus = TaskPhase;

/**
 * 面向外部调用方的稳定任务 DTO。
 * 调用方只依赖这个结构，不直接接触 TaskStore 的内部实现。
 */
export interface TaskSummary {
    id: string;
    videoPath: string;
    status: TaskStatus;
    currentPhase: string;
    updatedAt: string;
    outputs: TaskOutputs;
    config?: TaskConfig;
    lastError?: string;
    complianceHits?: number;
}

export interface EnqueueTaskInput {
    videoPath: string;
}

/**
 * 入队时允许覆写任务配置。
 * 这组参数同时也会被 Copilot tools 消费。
 */
export interface EnqueueTaskOptions extends TaskConfig {}

/**
 * 单次直跑完整流水线时的参数。
 * 当前主要用于保留未来脚本化入口，不建议 agent 默认走这条链路。
 */
export interface RunPipelineOptions extends TaskConfig {
    signal?: AbortSignal;
}

export interface TranscribeOptions {
    signal?: AbortSignal;
    logFn?: (msg: string) => void;
    taskModel?: string;
    taskLanguage?: string;
    outputDir?: string;
}

export interface OptimizeOptions {
    signal?: AbortSignal;
    logFn?: (msg: string) => void;
}

export interface TranslateOptions {
    signal?: AbortSignal;
    logFn?: (msg: string) => void;
    outputDir?: string;
}

export interface TranscribeResult {
    rawSrtPath: string;
}

export interface OptimizeResult {
    llmSrtPath: string;
    complianceHits: number;
}

export interface TranslateResult {
    translatedPaths: Record<string, string>;
    totalComplianceHits: number;
}

export interface PipelineResult {
    task: TaskSummary;
}

/**
 * 对外能力的唯一稳定门面。
 * 现有命令、Copilot agent、未来其他 VS Code 扩展都应该只依赖这一层。
 */
export interface SubtitleFlowApi {
    enqueueTask(input: EnqueueTaskInput, options?: EnqueueTaskOptions): Promise<TaskSummary>;
    enqueueTasks(inputs: EnqueueTaskInput[], options?: EnqueueTaskOptions): Promise<TaskSummary[]>;
    runPending(): void;
    getTask(taskId: string): TaskSummary | undefined;
    listTasks(): TaskSummary[];
    cleanStaleTasks(): number;
    pauseTask(taskId: string): void;
    resumeTask(taskId: string): void;
    retryTask(taskId: string): void;
    deleteTask(taskId: string): boolean;
    onDidChangeTasks(listener: (tasks: TaskSummary[]) => void): vscode.Disposable;
    transcribe(videoPath: string, options?: TranscribeOptions): Promise<TranscribeResult>;
    optimize(rawSrtPath: string, options?: OptimizeOptions): Promise<OptimizeResult>;
    translate(llmSrtPath: string, targetLanguages: string[], options?: TranslateOptions): Promise<TranslateResult>;
    runPipeline(videoPath: string, options?: RunPipelineOptions): Promise<PipelineResult>;
}

/**
 * 将内部任务记录转换为对外稳定 DTO。
 * 这里做浅拷贝，避免外部持有内部可变对象引用。
 */
export function toTaskSummary(task: TaskRecord): TaskSummary {
    return {
        id: task.id,
        videoPath: task.videoPath,
        status: task.status,
        currentPhase: task.currentPhase,
        updatedAt: task.updatedAt,
        outputs: {
            ...task.outputs,
            translated: { ...task.outputs.translated },
        },
        config: task.config ? { ...task.config } : undefined,
        lastError: task.lastError,
        complianceHits: task.complianceHits,
    };
}
