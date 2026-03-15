/**
 * participant 编排测试。
 * 验证自然语言请求会被拆成多步工具调用，而不是只执行单条命令。
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { createSubtitleFlowParticipantHandler } from '../../src/copilot/participant';
import type { SubtitleFlowApi, TaskSummary } from '../../src/publicApi';
import { SUBTITLE_FLOW_TOOL_NAMES } from '../../src/copilot/toolNames';

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'videoPath' | 'status'>): TaskSummary {
    return {
        id: partial.id,
        videoPath: partial.videoPath,
        createdAt: partial.createdAt ?? '2026-03-15T00:00:00.000Z',
        status: partial.status,
        currentPhase: partial.status,
        updatedAt: partial.updatedAt ?? '2026-03-15T00:00:00.000Z',
        batchId: partial.batchId,
        outputs: partial.outputs ?? { translated: {}, bilingualAss: {} },
        config: partial.config,
        lastError: partial.lastError,
        complianceHits: partial.complianceHits,
    };
}

function createApi(tasks: TaskSummary[]): SubtitleFlowApi {
    const allTasks = [...tasks];
    return {
        async enqueueTask(input) {
            const created = task({
                id: 'task_created',
                videoPath: input.videoPath,
                status: 'queued',
                updatedAt: '2026-03-15T10:00:00.000Z',
            });
            allTasks.push(created);
            return created;
        },
        async enqueueTasks(inputs) {
            return Promise.all(inputs.map((input) => this.enqueueTask(input).then((created) => ({ ...created, batchId: 'batch_test' }))));
        },
        async scanDirectory(directoryPath) {
            return {
                directoryPath,
                videos: [
                    `${directoryPath}/part001.mp4`,
                    `${directoryPath}/part002.mp4`,
                ],
                truncated: false,
                warnings: [],
            };
        },
        runPending() {},
        getBatch() {
            return undefined;
        },
        getLatestBatch() {
            return {
                id: 'batch_test',
                createdAt: '2026-03-15T10:00:00.000Z',
                updatedAt: '2026-03-15T10:00:00.000Z',
                taskIds: allTasks.map((item) => item.id),
                videoPaths: allTasks.map((item) => item.videoPath),
                counts: {
                    total: allTasks.length,
                    queued: allTasks.filter((item) => item.status === 'queued').length,
                    running: 0,
                    completed: allTasks.filter((item) => item.status === 'completed').length,
                    failed: allTasks.filter((item) => item.status === 'failed').length,
                    paused: allTasks.filter((item) => item.status === 'paused').length,
                },
            };
        },
        listBatches() {
            const latest = this.getLatestBatch();
            return latest ? [latest] : [];
        },
        getTask(taskId) {
            return allTasks.find((item) => item.id === taskId);
        },
        listTasks() {
            return allTasks.slice();
        },
        summarizeTaskResult(taskId) {
            const existing = allTasks.find((item) => item.id === taskId);
            if (!existing) {
                return undefined;
            }
            return {
                taskId,
                batchId: existing.batchId,
                status: existing.status,
                currentPhase: existing.currentPhase,
                videoPath: existing.videoPath,
                translatedPaths: { ...existing.outputs.translated },
                review: {
                    hasManualReview: false,
                    hasLexiconCandidates: false,
                    hasRecoverySummary: false,
                },
                message: 'ok',
            };
        },
        async rebuildTask(taskId, stage) {
            const existing = allTasks.find((item) => item.id === taskId);
            if (!existing) {
                return undefined;
            }
            existing.status = 'queued';
            existing.currentPhase = 'queued';
            return {
                task: existing,
                stage,
                removedPaths: [],
            };
        },
        cleanStaleTasks() {
            return 0;
        },
        pauseTask() {},
        resumeTask(taskId) {
            const target = allTasks.find((item) => item.id === taskId);
            if (target) {
                target.status = 'queued';
            }
        },
        retryTask(taskId) {
            const target = allTasks.find((item) => item.id === taskId);
            if (target) {
                target.status = 'queued';
            }
        },
        deleteTask(taskId) {
            const index = allTasks.findIndex((item) => item.id === taskId);
            if (index >= 0) {
                allTasks.splice(index, 1);
                return true;
            }
            return false;
        },
        onDidChangeTasks() {
            return { dispose() {} };
        },
        async transcribe() {
            return { rawSrtPath: '/tmp/demo.raw.srt' };
        },
        async optimize() {
            return { llmSrtPath: '/tmp/demo.llm.srt', complianceHits: 0 };
        },
        async translate() {
            return { translatedPaths: {}, totalComplianceHits: 0 };
        },
        async runPipeline(videoPath) {
            return { task: task({ id: 'task_pipeline', videoPath, status: 'completed' }) };
        },
    };
}

function createStream() {
    return {
        progressMessages: [] as string[],
        markdownMessages: [] as string[],
        progress(value: string) {
            this.progressMessages.push(value);
        },
        markdown(value: string) {
            this.markdownMessages.push(value);
        },
        button() {},
    };
}

describe('createSubtitleFlowParticipantHandler', () => {
    const vscodeTesting = vscode as any;

    beforeEach(() => {
        vscodeTesting.__testing.reset();
    });

    it('should orchestrate enqueue -> runPending -> get for natural language generation requests', async () => {
        const api = createApi([]);
        const context = { subscriptions: [] } as any;
        const extensionContext = {
            subscriptions: [],
            extensionUri: vscode.Uri.file(process.cwd()),
        } as any;
        void context;
        void extensionContext;

        const registeredTools = new Map<string, any>([
            [SUBTITLE_FLOW_TOOL_NAMES.enqueueTask, {
                invoke: async (options: any) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(await api.enqueueTask({ videoPath: options.input.videoPath }))),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.runPending, {
                invoke: async () => {
                    api.runPending();
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify({ ok: true }))]);
                },
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.getTask, {
                invoke: async (options: any) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(api.getTask(options.input.taskId))),
                ]),
            }],
        ]);

        for (const [name, tool] of registeredTools) {
            vscodeTesting.__testing.registeredTools.set(name, tool);
        }

        const handler = createSubtitleFlowParticipantHandler(api);
        const stream = createStream();

        await handler(
            {
                prompt: '生成字幕 /tmp/demo video.mp4',
                command: undefined,
                toolInvocationToken: undefined,
            } as any,
            {} as any,
            stream as any,
            vscodeTesting.CancellationToken.None
        );

        assert.deepEqual(
            vscodeTesting.__testing.toolInvocations.map((item: any) => item.name),
            [
                SUBTITLE_FLOW_TOOL_NAMES.enqueueTask,
                SUBTITLE_FLOW_TOOL_NAMES.runPending,
                SUBTITLE_FLOW_TOOL_NAMES.getTask,
            ]
        );
        assert.equal(
            stream.markdownMessages.some((message: string) => message.includes('Whisper 转录可能耗时较长')),
            true
        );
    });

    it('should orchestrate retry -> runPending -> get for failed task recovery', async () => {
        const api = createApi([
            task({
                id: 'task_failed',
                videoPath: '/tmp/demo.mp4',
                status: 'failed',
                updatedAt: '2026-03-15T10:00:00.000Z',
            }),
        ]);

        const registeredTools = new Map<string, any>([
            [SUBTITLE_FLOW_TOOL_NAMES.retryTask, {
                invoke: async (options: any) => {
                    api.retryTask(options.input.taskId);
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(JSON.stringify({ ok: true, taskId: options.input.taskId })),
                    ]);
                },
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.runPending, {
                invoke: async () => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({ ok: true })),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.getTask, {
                invoke: async (options: any) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(api.getTask(options.input.taskId))),
                ]),
            }],
        ]);

        for (const [name, tool] of registeredTools) {
            vscodeTesting.__testing.registeredTools.set(name, tool);
        }

        const handler = createSubtitleFlowParticipantHandler(api);
        const stream = createStream();

        await handler(
            {
                prompt: '重试失败任务',
                command: undefined,
                toolInvocationToken: undefined,
            } as any,
            {} as any,
            stream as any,
            vscodeTesting.CancellationToken.None
        );

        assert.deepEqual(
            vscodeTesting.__testing.toolInvocations.map((item: any) => item.name),
            [
                SUBTITLE_FLOW_TOOL_NAMES.retryTask,
                SUBTITLE_FLOW_TOOL_NAMES.runPending,
                SUBTITLE_FLOW_TOOL_NAMES.getTask,
            ]
        );
        assert.equal(
            stream.markdownMessages.some((message: string) => message.includes('失败任务已经重新入队')),
            true
        );
    });

    it('should orchestrate scanDirectory -> enqueueTasks -> runPending -> list for directory requests', async () => {
        const api = createApi([]);
        const directoryPath = '/tmp/demo folder';

        const registeredTools = new Map<string, any>([
            [SUBTITLE_FLOW_TOOL_NAMES.scanDirectory, {
                invoke: async (options: any) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(await api.scanDirectory(options.input.directoryPath))),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.enqueueTasks, {
                invoke: async (options: any) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(await api.enqueueTasks(options.input.inputs))),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.runPending, {
                invoke: async () => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({ ok: true })),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.listTasks, {
                invoke: async () => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(api.listTasks())),
                ]),
            }],
        ]);

        for (const [name, tool] of registeredTools) {
            vscodeTesting.__testing.registeredTools.set(name, tool);
        }

        const handler = createSubtitleFlowParticipantHandler(api);
        const stream = createStream();

        await handler(
            {
                prompt: `为目录 "${directoryPath}" 下的所有视频提供字幕`,
                command: undefined,
                toolInvocationToken: undefined,
            } as any,
            {} as any,
            stream as any,
            vscodeTesting.CancellationToken.None
        );

        assert.deepEqual(
            vscodeTesting.__testing.toolInvocations.map((item: any) => item.name),
            [
                SUBTITLE_FLOW_TOOL_NAMES.scanDirectory,
                SUBTITLE_FLOW_TOOL_NAMES.enqueueTasks,
                SUBTITLE_FLOW_TOOL_NAMES.runPending,
                SUBTITLE_FLOW_TOOL_NAMES.listTasks,
            ]
        );
        assert.equal(vscodeTesting.__testing.toolInvocations[0].options.input.recursive, true);
        assert.equal(
            stream.markdownMessages.some((message: string) => message.includes('个视频已批量入队')),
            true
        );
    });

    it('should explain the detected directory candidate when directory scan creates no tasks', async () => {
        const api = {
            ...createApi([]),
            async scanDirectory(directoryPath: string) {
                return {
                    directoryPath,
                    videos: [],
                    truncated: false,
                    warnings: [`目录不存在或无法访问：${directoryPath}`],
                };
            },
        } as SubtitleFlowApi;

        const directoryPath = '/tmp/not existing folder';
        const registeredTools = new Map<string, any>([
            [SUBTITLE_FLOW_TOOL_NAMES.scanDirectory, {
                invoke: async (options: any) => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(await api.scanDirectory(options.input.directoryPath))),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.enqueueTasks, {
                invoke: async () => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify([])),
                ]),
            }],
            [SUBTITLE_FLOW_TOOL_NAMES.runPending, {
                invoke: async () => new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify({ ok: true })),
                ]),
            }],
        ]);

        for (const [name, tool] of registeredTools) {
            vscodeTesting.__testing.registeredTools.set(name, tool);
        }

        const handler = createSubtitleFlowParticipantHandler(api);
        const stream = createStream();

        await handler(
            {
                prompt: `${directoryPath} 这个目录的视频生成字幕`,
                command: undefined,
                toolInvocationToken: undefined,
            } as any,
            {} as any,
            stream as any,
            vscodeTesting.CancellationToken.None
        );

        assert.equal(
            stream.markdownMessages.some((message: string) => message.includes('我识别到的目录候选是')),
            true
        );
        assert.equal(
            stream.markdownMessages.some((message: string) => message.includes('建议直接给目录加引号后重试')),
            true
        );
    });
});
