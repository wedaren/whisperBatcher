/**
 * 扩展入口测试。
 * 覆盖 activate 返回的公共 API、Copilot tools 注册和基础工具调用。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { activate } from '../../src/extension';
import { SUBTITLE_FLOW_CAPABILITIES } from '../../src/agent-host';
import { SUBTITLE_FLOW_CHAT_PARTICIPANT_ID, SUBTITLE_FLOW_TOOL_NAMES } from '../../src/copilot/toolNames';

describe('extension activate', () => {
    let tmpDir: string;
    const vscodeTesting = vscode as any;

    beforeEach(() => {
        vscodeTesting.__testing.reset();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-flow-extension-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return public api, agent host and register Copilot surfaces', async () => {
        const context = {
            globalStorageUri: vscode.Uri.file(tmpDir),
            extensionPath: process.cwd(),
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;

        const extensionExports = await activate(context);
        assert.equal(typeof extensionExports.enqueueTask, 'function');
        assert.equal(typeof extensionExports.listTasks, 'function');
        assert.equal(typeof extensionExports.listBatches, 'function');
        assert.equal(typeof extensionExports.summarizeTaskResult, 'function');
        assert.equal(typeof extensionExports.agentHost.listAgents, 'function');
        assert.equal(typeof extensionExports.agentHost.listCapabilities, 'function');
        assert.equal(typeof extensionExports.agentHost.invokeCapability, 'function');
        assert.equal(extensionExports.agentHost.listAgents().length >= 3, true);
        const enqueueCapability = extensionExports.agentHost.listCapabilities().find(
            (item) => item.name === SUBTITLE_FLOW_CAPABILITIES.enqueueTask
        );
        assert.ok(enqueueCapability);
        assert.deepEqual(enqueueCapability.inputSchema, {
            type: 'object',
            properties: {
                videoPath: { type: 'string' },
                whisperModel: { type: 'string' },
                whisperLanguage: { type: 'string' },
                targetLanguages: { type: 'array', items: { type: 'string' } },
                defaultSubtitleLanguage: { type: 'string' },
                generateBilingualAss: { type: 'boolean' },
                bilingualTargetLanguage: { type: 'string' },
            },
            required: ['videoPath'],
        });
        assert.equal(enqueueCapability.outputSchema?.type, 'object');

        assert.equal(vscodeTesting.__testing.createdParticipants.length, 1);
        assert.equal(vscodeTesting.__testing.createdParticipants[0].id, SUBTITLE_FLOW_CHAT_PARTICIPANT_ID);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.scanDirectory), true);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.enqueueTask), true);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.enqueueTasks), true);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.listBatches), true);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.getLatestBatch), true);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.summarizeTaskResult), true);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.getTask), true);
    });

    it('should allow enqueue and get through registered tools', async () => {
        const context = {
            globalStorageUri: vscode.Uri.file(tmpDir),
            extensionPath: process.cwd(),
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;

        await activate(context);

        const enqueueResult: any = await vscode.lm.invokeTool(
            SUBTITLE_FLOW_TOOL_NAMES.enqueueTask,
            {
                input: { videoPath: '/tmp/demo.mp4' },
                toolInvocationToken: undefined,
            },
            vscodeTesting.CancellationToken.None
        );
        const enqueuePayload = JSON.parse(enqueueResult.content[0].value);
        assert.equal(typeof enqueuePayload.id, 'string');
        assert.equal(enqueuePayload.videoPath, '/tmp/demo.mp4');

        const getResult: any = await vscode.lm.invokeTool(
            SUBTITLE_FLOW_TOOL_NAMES.getTask,
            {
                input: { taskId: enqueuePayload.id },
                toolInvocationToken: undefined,
            },
            vscodeTesting.CancellationToken.None
        );
        const getPayload = JSON.parse(getResult.content[0].value);
        assert.equal(getPayload.id, enqueuePayload.id);
        assert.equal(getPayload.status, 'queued');
    });

    it('should allow invoking agent host capabilities', async () => {
        const context = {
            globalStorageUri: vscode.Uri.file(tmpDir),
            extensionPath: process.cwd(),
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;

        const extensionExports = await activate(context);
        const task = await extensionExports.agentHost.invokeCapability(
            SUBTITLE_FLOW_CAPABILITIES.enqueueTask,
            { videoPath: '/tmp/host-demo.mp4' }
        ) as { id: string; videoPath: string };

        assert.equal(task.videoPath, '/tmp/host-demo.mp4');

        const fetched = await extensionExports.agentHost.invokeCapability(
            SUBTITLE_FLOW_CAPABILITIES.getTask,
            { taskId: task.id }
        ) as { id: string; status: string };
        assert.equal(fetched.id, task.id);
        assert.equal(fetched.status, 'queued');

        const result = await extensionExports.agentHost.invokeCapability(
            SUBTITLE_FLOW_CAPABILITIES.summarizeTaskResult,
            { taskId: task.id }
        ) as { taskId: string; message: string };
        assert.equal(result.taskId, task.id);
        assert.equal(typeof result.message, 'string');
    });

    it('should allow invoking directory capabilities through agent host', async () => {
        const videosDir = path.join(tmpDir, 'videos');
        fs.mkdirSync(videosDir, { recursive: true });
        fs.writeFileSync(path.join(videosDir, 'part001.mp4'), 'demo');
        fs.writeFileSync(path.join(videosDir, 'part002.mkv'), 'demo');
        fs.writeFileSync(path.join(videosDir, 'note.txt'), 'ignore');

        const context = {
            globalStorageUri: vscode.Uri.file(tmpDir),
            extensionPath: process.cwd(),
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;

        const extensionExports = await activate(context);
        const scan = await extensionExports.agentHost.invokeCapability(
            SUBTITLE_FLOW_CAPABILITIES.scanDirectory,
            { directoryPath: videosDir }
        ) as { videos: string[] };
        assert.equal(scan.videos.length, 2);

        const result = await extensionExports.agentHost.invokeCapability(
            SUBTITLE_FLOW_CAPABILITIES.enqueueDirectory,
            { directoryPath: videosDir, autoStart: false }
        ) as { tasks: Array<{ videoPath: string }>; started: boolean };
        assert.equal(result.tasks.length, 2);
        assert.equal(result.started, false);
    });

    it('should reject directories when creating a single task', async () => {
        const videosDir = path.join(tmpDir, 'videos');
        fs.mkdirSync(videosDir, { recursive: true });

        const context = {
            globalStorageUri: vscode.Uri.file(tmpDir),
            extensionPath: process.cwd(),
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;

        const extensionExports = await activate(context);

        await assert.rejects(
            () => extensionExports.enqueueTask({ videoPath: videosDir }),
            /must be a file|supported video file/
        );
    });
});
