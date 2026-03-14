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

    it('should return public api and register Copilot surfaces', async () => {
        const context = {
            globalStorageUri: vscode.Uri.file(tmpDir),
            extensionPath: process.cwd(),
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;

        const api = await activate(context);
        assert.equal(typeof api.enqueueTask, 'function');
        assert.equal(typeof api.listTasks, 'function');

        assert.equal(vscodeTesting.__testing.createdParticipants.length, 1);
        assert.equal(vscodeTesting.__testing.createdParticipants[0].id, SUBTITLE_FLOW_CHAT_PARTICIPANT_ID);
        assert.equal(vscodeTesting.__testing.registeredTools.has(SUBTITLE_FLOW_TOOL_NAMES.enqueueTask), true);
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
});
