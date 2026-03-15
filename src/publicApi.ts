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
    createdAt: string;
    status: TaskStatus;
    currentPhase: string;
    updatedAt: string;
    batchId?: string;
    outputs: TaskOutputs;
    config?: TaskConfig;
    lastError?: string;
    complianceHits?: number;
}

export interface BatchTaskCounts {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    paused: number;
}

export interface BatchSummary {
    id: string;
    createdAt: string;
    updatedAt: string;
    taskIds: string[];
    videoPaths: string[];
    counts: BatchTaskCounts;
}

export interface ReviewSummary {
    hasManualReview: boolean;
    manualReviewPath?: string;
    hasLexiconCandidates: boolean;
    lexiconCandidatesPath?: string;
    hasRecoverySummary: boolean;
    recoverySummaryPath?: string;
}

export interface TaskResultSummary {
    taskId: string;
    batchId?: string;
    status: TaskStatus;
    currentPhase: string;
    videoPath: string;
    outputFolder?: string;
    defaultSubtitlePath?: string;
    optimizedSubtitlePath?: string;
    rawSubtitlePath?: string;
    translatedPaths: Record<string, string>;
    logPath?: string;
    configPath?: string;
    review: ReviewSummary;
    message: string;
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

export type RebuildStage = 'transcribe' | 'optimize' | 'translate';

export interface RebuildTaskResult {
    task: TaskSummary;
    stage: RebuildStage;
    backupDir?: string;
    removedPaths: string[];
}

export interface ScanDirectoryOptions {
    recursive?: boolean;
    maxFiles?: number;
}

export interface ScanDirectoryResult {
    directoryPath: string;
    videos: string[];
    truncated: boolean;
    warnings: string[];
    suggestedDirectoryPath?: string;
}

/**
 * 简化版 JSON Schema 结构。
 * 当前用于描述 agent capability 和 Copilot tool 的输入输出，不引入额外运行时依赖。
 */
export interface JsonSchema {
    type?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    required?: string[];
    enum?: string[];
    description?: string;
    additionalProperties?: boolean;
}

/**
 * Agent 能力的稳定描述。
 * 外部插件只依赖这些描述和 `invokeCapability`，不直接触碰内部 agent 实现。
 */
export interface AgentCapabilityManifest {
    name: string;
    agent: string;
    description: string;
    inputSchema?: JsonSchema;
    outputSchema?: JsonSchema;
    inputSchemaSummary: string;
    outputSchemaSummary: string;
}

/**
 * 单个 agent 的自描述信息。
 * 这里不暴露运行时实现，仅用于说明职责和可调用能力。
 */
export interface AgentManifest {
    name: string;
    description: string;
    responsibilities: string[];
    tools: string[];
    capabilityNames: string[];
    inputSchemaSummary?: string;
    outputSchemaSummary?: string;
}

/**
 * 对外能力的唯一稳定门面。
 * 现有命令、Copilot agent、未来其他 VS Code 扩展都应该只依赖这一层。
 */
export interface SubtitleFlowApi {
    enqueueTask(input: EnqueueTaskInput, options?: EnqueueTaskOptions): Promise<TaskSummary>;
    enqueueTasks(inputs: EnqueueTaskInput[], options?: EnqueueTaskOptions): Promise<TaskSummary[]>;
    scanDirectory(directoryPath: string, options?: ScanDirectoryOptions): Promise<ScanDirectoryResult>;
    runPending(): void;
    getTask(taskId: string): TaskSummary | undefined;
    listTasks(): TaskSummary[];
    getBatch(batchId: string): BatchSummary | undefined;
    getLatestBatch(): BatchSummary | undefined;
    listBatches(): BatchSummary[];
    summarizeTaskResult(taskId: string): TaskResultSummary | undefined;
    rebuildTask(taskId: string, stage: RebuildStage): Promise<RebuildTaskResult | undefined>;
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
 * 插件级 Agent Host。
 * 外部扩展或外部 agent 通过它发现和调用字幕能力，而不是直接依赖内部 agent 类。
 */
export interface SubtitleFlowAgentHost {
    listAgents(): AgentManifest[];
    listCapabilities(): AgentCapabilityManifest[];
    invokeCapability(name: string, input?: Record<string, unknown>): Promise<unknown>;
}

/**
 * 扩展对外 exports。
 * 保留原有 API 方法，另外补充 `agentHost` 供程序化 agent 集成。
 */
export interface SubtitleFlowExtensionExports extends SubtitleFlowApi {
    agentHost: SubtitleFlowAgentHost;
}

/**
 * 将内部任务记录转换为对外稳定 DTO。
 * 这里做浅拷贝，避免外部持有内部可变对象引用。
 */
export function toTaskSummary(task: TaskRecord): TaskSummary {
    return {
        id: task.id,
        videoPath: task.videoPath,
        createdAt: task.createdAt,
        status: task.status,
        currentPhase: task.currentPhase,
        updatedAt: task.updatedAt,
        batchId: task.batchId,
        outputs: {
            ...task.outputs,
            translated: { ...task.outputs.translated },
        },
        config: task.config ? { ...task.config } : undefined,
        lastError: task.lastError,
        complianceHits: task.complianceHits,
    };
}
