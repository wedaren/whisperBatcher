/**
 * TaskAgent 测试。
 * 验证 task-agent 目录下的策略和运行入口可以独立工作。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskSummary } from '../../src/publicApi';
import { buildTaskAgentWorkflow, inferTaskAgentIntent, parseTaskAgentIntent } from '../../src/agents/task-agent/policy';
import { planTaskAgentWorkflow } from '../../src/agents/task-agent/planner';

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'videoPath' | 'status'>): TaskSummary {
    return {
        id: partial.id,
        videoPath: partial.videoPath,
        status: partial.status,
        currentPhase: partial.status,
        updatedAt: partial.updatedAt ?? '2026-03-15T00:00:00.000Z',
        outputs: partial.outputs ?? { translated: {} },
        config: partial.config,
        lastError: partial.lastError,
        complianceHits: partial.complianceHits,
    };
}

describe('task-agent policy', () => {
    it('should parse explicit enqueue command', () => {
        const intent = parseTaskAgentIntent('/enqueue', '/enqueue "/tmp/demo.mp4"');
        assert.deepEqual(intent, {
            type: 'enqueue',
            videoPath: '/tmp/demo.mp4',
            autoStart: false,
        });
    });

    it('should infer retry intent from natural language', () => {
        const intent = inferTaskAgentIntent(
            '重试失败任务',
            [task({ id: 'task_failed', videoPath: '/tmp/demo.mp4', status: 'failed' })],
            { type: 'help' }
        );
        assert.deepEqual(intent, { type: 'retry', taskId: 'task_failed' });
    });

    it('should build enqueue workflow with runPending handoff', () => {
        const workflow = buildTaskAgentWorkflow(
            { type: 'enqueue', videoPath: '/tmp/demo.mp4', autoStart: true },
            []
        );
        assert.ok(workflow);
        assert.deepEqual(workflow?.steps.map((step) => step.toolName), [
            'subtitleflow_enqueue_task',
            'subtitleflow_run_pending',
        ]);
        assert.equal(workflow?.inspectTaskAfterStep, 1);
    });

    it('should infer directory enqueue intent from natural language', () => {
        const intent = inferTaskAgentIntent(
            '为目录 "/tmp/videos" 下的所有视频提供字幕',
            [],
            { type: 'help' }
        );
        assert.deepEqual(intent, {
            type: 'enqueueDirectory',
            directoryPath: '/tmp/videos',
            autoStart: true,
            recursive: true,
        });
    });

    it('should build planner workflow for directory requests', () => {
        const plan = planTaskAgentWorkflow(
            '为目录 "/tmp/videos" 下的所有视频提供字幕',
            undefined,
            []
        );
        assert.ok(plan.workflow);
        assert.deepEqual(plan.workflow?.steps.map((step) => step.toolName), [
            'subtitleflow_scan_directory',
            'subtitleflow_enqueue_tasks',
            'subtitleflow_run_pending',
        ]);
    });
});
