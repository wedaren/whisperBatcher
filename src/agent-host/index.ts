import type {
    AgentCapabilityManifest,
    AgentManifest,
    EnqueueTaskInput,
    EnqueueTaskOptions,
    OptimizeOptions,
    SubtitleFlowAgentHost,
    SubtitleFlowApi,
    SubtitleFlowExtensionExports,
    TranslateOptions,
    JsonSchema,
} from '../publicApi';
import { TASK_AGENT_TOOL_MANIFESTS } from '../agents/task-agent/tools';

/**
 * 插件级能力名常量。
 * 其他扩展应通过这些稳定名字调用，而不是依赖内部类名。
 */
export const SUBTITLE_FLOW_CAPABILITIES = {
    scanDirectory: 'task.scan-directory',
    enqueueTask: 'task.enqueue',
    enqueueTasks: 'task.enqueue-batch',
    enqueueDirectory: 'task.enqueue-directory',
    runPending: 'task.run-pending',
    listBatches: 'task.list-batches',
    getLatestBatch: 'task.get-latest-batch',
    getTask: 'task.get',
    listTasks: 'task.list',
    summarizeTaskResult: 'task.summarize-result',
    pauseTask: 'task.pause',
    resumeTask: 'task.resume',
    retryTask: 'task.retry',
    deleteTask: 'task.delete',
    runPipeline: 'task.run-pipeline',
    optimizeSubtitle: 'subtitle.optimize',
    translateSubtitle: 'subtitle.translate',
    reviewFailures: 'review.inspect-failures',
} as const;

const TASK_TOOL_TO_CAPABILITY = {
    listTasks: SUBTITLE_FLOW_CAPABILITIES.listTasks,
    listBatches: SUBTITLE_FLOW_CAPABILITIES.listBatches,
    getLatestBatch: SUBTITLE_FLOW_CAPABILITIES.getLatestBatch,
    getTask: SUBTITLE_FLOW_CAPABILITIES.getTask,
    summarizeTaskResult: SUBTITLE_FLOW_CAPABILITIES.summarizeTaskResult,
    enqueueTask: SUBTITLE_FLOW_CAPABILITIES.enqueueTask,
    enqueueTasks: SUBTITLE_FLOW_CAPABILITIES.enqueueTasks,
    scanDirectory: SUBTITLE_FLOW_CAPABILITIES.scanDirectory,
    runPending: SUBTITLE_FLOW_CAPABILITIES.runPending,
    pauseTask: SUBTITLE_FLOW_CAPABILITIES.pauseTask,
    resumeTask: SUBTITLE_FLOW_CAPABILITIES.resumeTask,
    retryTask: SUBTITLE_FLOW_CAPABILITIES.retryTask,
    deleteTask: SUBTITLE_FLOW_CAPABILITIES.deleteTask,
} as const;

const TASK_SUMMARY_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        videoPath: { type: 'string' },
        createdAt: { type: 'string' },
        status: { type: 'string' },
        currentPhase: { type: 'string' },
        updatedAt: { type: 'string' },
        batchId: { type: 'string' },
        outputs: { type: 'object' },
        config: { type: 'object' },
        lastError: { type: 'string' },
        complianceHits: { type: 'number' },
    },
    required: ['id', 'videoPath', 'createdAt', 'status', 'currentPhase', 'updatedAt', 'outputs'],
};

const BATCH_SUMMARY_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
        taskIds: { type: 'array', items: { type: 'string' } },
        videoPaths: { type: 'array', items: { type: 'string' } },
        counts: { type: 'object' },
    },
    required: ['id', 'createdAt', 'updatedAt', 'taskIds', 'videoPaths', 'counts'],
};

const TASK_RESULT_SUMMARY_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        taskId: { type: 'string' },
        batchId: { type: 'string' },
        status: { type: 'string' },
        currentPhase: { type: 'string' },
        videoPath: { type: 'string' },
        outputFolder: { type: 'string' },
        defaultSubtitlePath: { type: 'string' },
        optimizedSubtitlePath: { type: 'string' },
        rawSubtitlePath: { type: 'string' },
        translatedPaths: { type: 'object' },
        logPath: { type: 'string' },
        configPath: { type: 'string' },
        review: { type: 'object' },
        message: { type: 'string' },
    },
    required: ['taskId', 'status', 'currentPhase', 'videoPath', 'translatedPaths', 'review', 'message'],
};

const TASK_CONTROL_RESULT_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        ok: { type: 'boolean' },
        started: { type: 'boolean' },
        paused: { type: 'boolean' },
        resumed: { type: 'boolean' },
        retried: { type: 'boolean' },
        deleted: { type: 'boolean' },
        taskId: { type: 'string' },
        message: { type: 'string' },
    },
};

function taskCapabilityOutputSchema(toolKey: keyof typeof TASK_TOOL_TO_CAPABILITY): JsonSchema {
    if (toolKey === 'listTasks') {
        return { type: 'array', items: TASK_SUMMARY_SCHEMA };
    }
    if (toolKey === 'listBatches') {
        return { type: 'array', items: BATCH_SUMMARY_SCHEMA };
    }
    if (toolKey === 'getLatestBatch') {
        return BATCH_SUMMARY_SCHEMA;
    }
    if (toolKey === 'getTask' || toolKey === 'enqueueTask') {
        return TASK_SUMMARY_SCHEMA;
    }
    if (toolKey === 'summarizeTaskResult') {
        return TASK_RESULT_SUMMARY_SCHEMA;
    }
    if (toolKey === 'enqueueTasks') {
        return { type: 'array', items: TASK_SUMMARY_SCHEMA };
    }
    if (toolKey === 'scanDirectory') {
        return {
            type: 'object',
            properties: {
                directoryPath: { type: 'string' },
                videos: { type: 'array', items: { type: 'string' } },
                truncated: { type: 'boolean' },
                warnings: { type: 'array', items: { type: 'string' } },
                suggestedDirectoryPath: { type: 'string' },
            },
            required: ['directoryPath', 'videos', 'truncated', 'warnings'],
        };
    }
    return TASK_CONTROL_RESULT_SCHEMA;
}

export function buildSubtitleFlowCapabilities(): AgentCapabilityManifest[] {
    return [
        ...TASK_AGENT_TOOL_MANIFESTS.map((tool) => ({
            name: TASK_TOOL_TO_CAPABILITY[tool.key],
            agent: 'task-agent',
            description: tool.modelDescription,
            inputSchema: tool.inputSchema as JsonSchema,
            outputSchema: taskCapabilityOutputSchema(tool.key),
            inputSchemaSummary: JSON.stringify(tool.inputSchema),
            outputSchemaSummary:
                tool.key === 'listBatches'
                    ? 'BatchSummary[]'
                    : tool.key === 'getLatestBatch'
                        ? 'BatchSummary'
                        : tool.key === 'summarizeTaskResult'
                            ? 'TaskResultSummary'
                            : 'TaskSummary、TaskSummary[] 或任务控制确认结果',
        })),
        {
            name: SUBTITLE_FLOW_CAPABILITIES.enqueueDirectory,
            agent: 'task-agent',
            description: '扫描目录并为其中的视频批量创建后台字幕任务。',
            inputSchema: {
                type: 'object',
                properties: {
                    directoryPath: { type: 'string' },
                    recursive: { type: 'boolean' },
                    maxFiles: { type: 'number' },
                    autoStart: { type: 'boolean' },
                    options: { type: 'object' },
                },
                required: ['directoryPath'],
            },
            outputSchema: {
                type: 'object',
                properties: {
                    scan: {
                        type: 'object',
                        properties: {
                            directoryPath: { type: 'string' },
                            videos: { type: 'array', items: { type: 'string' } },
                            truncated: { type: 'boolean' },
                            warnings: { type: 'array', items: { type: 'string' } },
                            suggestedDirectoryPath: { type: 'string' },
                        },
                        required: ['directoryPath', 'videos', 'truncated', 'warnings'],
                    },
                    tasks: { type: 'array', items: TASK_SUMMARY_SCHEMA },
                    started: { type: 'boolean' },
                },
                required: ['scan', 'tasks', 'started'],
            },
            inputSchemaSummary: '{ directoryPath: string, recursive?: boolean, maxFiles?: number, autoStart?: boolean, options?: EnqueueTaskOptions }',
            outputSchemaSummary: '{ scan: ScanDirectoryResult, tasks: TaskSummary[], started: boolean }',
        },
        {
            name: SUBTITLE_FLOW_CAPABILITIES.runPipeline,
            agent: 'task-agent',
            description: '同步直跑单个视频的完整流水线。',
            inputSchema: {
                type: 'object',
                properties: {
                    videoPath: { type: 'string' },
                    options: { type: 'object' },
                },
                required: ['videoPath'],
            },
            outputSchema: {
                type: 'object',
                properties: { task: TASK_SUMMARY_SCHEMA },
                required: ['task'],
            },
            inputSchemaSummary: '{ videoPath: string, options?: RunPipelineOptions }',
            outputSchemaSummary: 'PipelineResult',
        },
        {
            name: SUBTITLE_FLOW_CAPABILITIES.optimizeSubtitle,
            agent: 'execution-agent',
            description: '执行字幕优化步骤。',
            inputSchema: {
                type: 'object',
                properties: {
                    rawSrtPath: { type: 'string' },
                    options: { type: 'object' },
                },
                required: ['rawSrtPath'],
            },
            outputSchema: {
                type: 'object',
                properties: {
                    llmSrtPath: { type: 'string' },
                    complianceHits: { type: 'number' },
                },
                required: ['llmSrtPath', 'complianceHits'],
            },
            inputSchemaSummary: '{ rawSrtPath: string, options?: OptimizeOptions }',
            outputSchemaSummary: 'OptimizeResult',
        },
        {
            name: SUBTITLE_FLOW_CAPABILITIES.translateSubtitle,
            agent: 'execution-agent',
            description: '执行字幕翻译步骤。',
            inputSchema: {
                type: 'object',
                properties: {
                    llmSrtPath: { type: 'string' },
                    targetLanguages: { type: 'array', items: { type: 'string' } },
                    options: { type: 'object' },
                },
                required: ['llmSrtPath', 'targetLanguages'],
            },
            outputSchema: {
                type: 'object',
                properties: {
                    translatedPaths: { type: 'object' },
                    totalComplianceHits: { type: 'number' },
                },
                required: ['translatedPaths', 'totalComplianceHits'],
            },
            inputSchemaSummary: '{ llmSrtPath: string, targetLanguages: string[], options?: TranslateOptions }',
            outputSchemaSummary: 'TranslateResult',
        },
        {
            name: SUBTITLE_FLOW_CAPABILITIES.reviewFailures,
            agent: 'review-agent',
            description: '查询失败审查工件位置与状态。',
            inputSchema: {
                type: 'object',
                properties: { taskId: { type: 'string' } },
                required: ['taskId'],
            },
            outputSchema: {
                type: 'object',
                properties: {
                    taskId: { type: 'string' },
                    manualReviewPath: { type: 'string' },
                    lexiconCandidatesPath: { type: 'string' },
                },
                required: ['taskId'],
            },
            inputSchemaSummary: '{ taskId: string }',
            outputSchemaSummary: '{ taskId: string, manualReviewPath?: string, lexiconCandidatesPath?: string }',
        },
    ];
}

/**
 * Subtitle Flow 的插件级 host。
 * 它把稳定 API 重新组织为 capability 调用入口，方便其他插件或外部 agent 集成。
 */
export class SubtitleFlowAgentHostService implements SubtitleFlowAgentHost {
    constructor(
        private readonly api: SubtitleFlowApi,
        private readonly agents: AgentManifest[],
        private readonly capabilities: AgentCapabilityManifest[] = buildSubtitleFlowCapabilities()
    ) {}

    listAgents(): AgentManifest[] {
        return this.agents.map((agent) => ({
            ...agent,
            responsibilities: [...agent.responsibilities],
            tools: [...agent.tools],
            capabilityNames: [...agent.capabilityNames],
        }));
    }

    listCapabilities(): AgentCapabilityManifest[] {
        return this.capabilities.map((capability) => ({ ...capability }));
    }

    async invokeCapability(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
        switch (name) {
            case SUBTITLE_FLOW_CAPABILITIES.enqueueTask:
                return this.api.enqueueTask(
                    { videoPath: this.requireString(input.videoPath, 'videoPath') },
                    input.options as EnqueueTaskOptions | undefined
                );
            case SUBTITLE_FLOW_CAPABILITIES.enqueueTasks:
                return this.api.enqueueTasks(
                    this.requireEnqueueInputs(input.inputs),
                    input.options as EnqueueTaskOptions | undefined
                );
            case SUBTITLE_FLOW_CAPABILITIES.scanDirectory:
                return this.api.scanDirectory(
                    this.requireString(input.directoryPath, 'directoryPath'),
                    {
                        recursive: typeof input.recursive === 'boolean' ? input.recursive : undefined,
                        maxFiles: typeof input.maxFiles === 'number' ? input.maxFiles : undefined,
                    }
                );
            case SUBTITLE_FLOW_CAPABILITIES.enqueueDirectory: {
                const scan = await this.api.scanDirectory(
                    this.requireString(input.directoryPath, 'directoryPath'),
                    {
                        recursive: typeof input.recursive === 'boolean' ? input.recursive : undefined,
                        maxFiles: typeof input.maxFiles === 'number' ? input.maxFiles : undefined,
                    }
                );
                const tasks = await this.api.enqueueTasks(
                    scan.videos.map((videoPath) => ({ videoPath })),
                    input.options as EnqueueTaskOptions | undefined
                );
                const started = typeof input.autoStart === 'boolean' ? input.autoStart : true;
                if (started) {
                    this.api.runPending();
                }
                return { scan, tasks, started };
            }
            case SUBTITLE_FLOW_CAPABILITIES.runPending:
                this.api.runPending();
                return { started: true };
            case SUBTITLE_FLOW_CAPABILITIES.listBatches:
                return this.api.listBatches();
            case SUBTITLE_FLOW_CAPABILITIES.getLatestBatch:
                return this.api.getLatestBatch();
            case SUBTITLE_FLOW_CAPABILITIES.getTask:
                return this.api.getTask(this.requireString(input.taskId, 'taskId'));
            case SUBTITLE_FLOW_CAPABILITIES.listTasks:
                return this.api.listTasks();
            case SUBTITLE_FLOW_CAPABILITIES.summarizeTaskResult:
                return this.api.summarizeTaskResult(this.requireString(input.taskId, 'taskId'));
            case SUBTITLE_FLOW_CAPABILITIES.pauseTask: {
                const taskId = this.requireString(input.taskId, 'taskId');
                this.api.pauseTask(taskId);
                return { paused: true, taskId };
            }
            case SUBTITLE_FLOW_CAPABILITIES.resumeTask: {
                const taskId = this.requireString(input.taskId, 'taskId');
                this.api.resumeTask(taskId);
                return { resumed: true, taskId };
            }
            case SUBTITLE_FLOW_CAPABILITIES.retryTask: {
                const taskId = this.requireString(input.taskId, 'taskId');
                this.api.retryTask(taskId);
                return { retried: true, taskId };
            }
            case SUBTITLE_FLOW_CAPABILITIES.deleteTask: {
                const taskId = this.requireString(input.taskId, 'taskId');
                return { deleted: this.api.deleteTask(taskId), taskId };
            }
            case SUBTITLE_FLOW_CAPABILITIES.runPipeline:
                return this.api.runPipeline(
                    this.requireString(input.videoPath, 'videoPath'),
                    input.options as any
                );
            case SUBTITLE_FLOW_CAPABILITIES.optimizeSubtitle:
                return this.api.optimize(
                    this.requireString(input.rawSrtPath, 'rawSrtPath'),
                    input.options as OptimizeOptions | undefined
                );
            case SUBTITLE_FLOW_CAPABILITIES.translateSubtitle:
                return this.api.translate(
                    this.requireString(input.llmSrtPath, 'llmSrtPath'),
                    this.requireStringArray(input.targetLanguages, 'targetLanguages'),
                    input.options as TranslateOptions | undefined
                );
            case SUBTITLE_FLOW_CAPABILITIES.reviewFailures: {
                const taskId = this.requireString(input.taskId, 'taskId');
                const task = this.api.getTask(taskId);
                return {
                    taskId,
                    manualReviewPath: task?.outputs.folder ? `${task.outputs.folder}/manual-review.json` : undefined,
                    lexiconCandidatesPath: task?.outputs.folder ? `${task.outputs.folder}/lexicon-candidates.json` : undefined,
                };
            }
            default:
                throw new Error(`Unknown Subtitle Flow capability: ${name}`);
        }
    }

    private requireString(value: unknown, field: string): string {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`Capability input field "${field}" must be a non-empty string`);
        }
        return value;
    }

    private requireStringArray(value: unknown, field: string): string[] {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
            throw new Error(`Capability input field "${field}" must be a string[]`);
        }
        return value as string[];
    }

    private requireEnqueueInputs(value: unknown): EnqueueTaskInput[] {
        if (!Array.isArray(value)) {
            throw new Error('Capability input field "inputs" must be an array');
        }
        return value.map((item) => {
            if (!item || typeof item !== 'object' || typeof (item as { videoPath?: unknown }).videoPath !== 'string') {
                throw new Error('Each enqueue input must contain a videoPath string');
            }
            return { videoPath: (item as { videoPath: string }).videoPath };
        });
    }
}

/**
 * 对外 exports 包装器。
 * 保留原有 SubtitleFlowApi 形状，同时额外挂出 `agentHost`。
 */
export class SubtitleFlowExtensionExportsService implements SubtitleFlowExtensionExports {
    constructor(
        private readonly api: SubtitleFlowApi,
        readonly agentHost: SubtitleFlowAgentHost
    ) {}

    enqueueTask(...args: Parameters<SubtitleFlowApi['enqueueTask']>): ReturnType<SubtitleFlowApi['enqueueTask']> {
        return this.api.enqueueTask(...args);
    }

    enqueueTasks(...args: Parameters<SubtitleFlowApi['enqueueTasks']>): ReturnType<SubtitleFlowApi['enqueueTasks']> {
        return this.api.enqueueTasks(...args);
    }

    scanDirectory(...args: Parameters<SubtitleFlowApi['scanDirectory']>): ReturnType<SubtitleFlowApi['scanDirectory']> {
        return this.api.scanDirectory(...args);
    }

    runPending(...args: Parameters<SubtitleFlowApi['runPending']>): ReturnType<SubtitleFlowApi['runPending']> {
        return this.api.runPending(...args);
    }

    getTask(...args: Parameters<SubtitleFlowApi['getTask']>): ReturnType<SubtitleFlowApi['getTask']> {
        return this.api.getTask(...args);
    }

    listTasks(...args: Parameters<SubtitleFlowApi['listTasks']>): ReturnType<SubtitleFlowApi['listTasks']> {
        return this.api.listTasks(...args);
    }

    getBatch(...args: Parameters<SubtitleFlowApi['getBatch']>): ReturnType<SubtitleFlowApi['getBatch']> {
        return this.api.getBatch(...args);
    }

    getLatestBatch(...args: Parameters<SubtitleFlowApi['getLatestBatch']>): ReturnType<SubtitleFlowApi['getLatestBatch']> {
        return this.api.getLatestBatch(...args);
    }

    listBatches(...args: Parameters<SubtitleFlowApi['listBatches']>): ReturnType<SubtitleFlowApi['listBatches']> {
        return this.api.listBatches(...args);
    }

    summarizeTaskResult(...args: Parameters<SubtitleFlowApi['summarizeTaskResult']>): ReturnType<SubtitleFlowApi['summarizeTaskResult']> {
        return this.api.summarizeTaskResult(...args);
    }

    rebuildTask(...args: Parameters<SubtitleFlowApi['rebuildTask']>): ReturnType<SubtitleFlowApi['rebuildTask']> {
        return this.api.rebuildTask(...args);
    }

    cleanStaleTasks(...args: Parameters<SubtitleFlowApi['cleanStaleTasks']>): ReturnType<SubtitleFlowApi['cleanStaleTasks']> {
        return this.api.cleanStaleTasks(...args);
    }

    pauseTask(...args: Parameters<SubtitleFlowApi['pauseTask']>): ReturnType<SubtitleFlowApi['pauseTask']> {
        return this.api.pauseTask(...args);
    }

    resumeTask(...args: Parameters<SubtitleFlowApi['resumeTask']>): ReturnType<SubtitleFlowApi['resumeTask']> {
        return this.api.resumeTask(...args);
    }

    retryTask(...args: Parameters<SubtitleFlowApi['retryTask']>): ReturnType<SubtitleFlowApi['retryTask']> {
        return this.api.retryTask(...args);
    }

    deleteTask(...args: Parameters<SubtitleFlowApi['deleteTask']>): ReturnType<SubtitleFlowApi['deleteTask']> {
        return this.api.deleteTask(...args);
    }

    onDidChangeTasks(...args: Parameters<SubtitleFlowApi['onDidChangeTasks']>): ReturnType<SubtitleFlowApi['onDidChangeTasks']> {
        return this.api.onDidChangeTasks(...args);
    }

    transcribe(...args: Parameters<SubtitleFlowApi['transcribe']>): ReturnType<SubtitleFlowApi['transcribe']> {
        return this.api.transcribe(...args);
    }

    optimize(...args: Parameters<SubtitleFlowApi['optimize']>): ReturnType<SubtitleFlowApi['optimize']> {
        return this.api.optimize(...args);
    }

    translate(...args: Parameters<SubtitleFlowApi['translate']>): ReturnType<SubtitleFlowApi['translate']> {
        return this.api.translate(...args);
    }

    runPipeline(...args: Parameters<SubtitleFlowApi['runPipeline']>): ReturnType<SubtitleFlowApi['runPipeline']> {
        return this.api.runPipeline(...args);
    }
}
