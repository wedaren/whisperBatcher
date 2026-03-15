/**
 * Copilot agent 规划测试。
 * 验证自然语言能够被映射成稳定的后台任务控制动作。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskSummary } from '../../src/publicApi';
import { inferTaskAgentIntent } from '../../src/agents/task-agent/policy';

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'videoPath' | 'status'>): TaskSummary {
    return {
        id: partial.id,
        videoPath: partial.videoPath,
        createdAt: partial.createdAt ?? '2026-03-15T00:00:00.000Z',
        status: partial.status,
        currentPhase: partial.status,
        updatedAt: partial.updatedAt ?? '2026-03-15T00:00:00.000Z',
        batchId: partial.batchId,
        outputs: partial.outputs ?? { translated: {} },
        config: partial.config,
        lastError: partial.lastError,
        complianceHits: partial.complianceHits,
    };
}

describe('inferParticipantIntent', () => {
    it('should auto-create-and-run when prompt includes a video path', () => {
        const result = inferTaskAgentIntent(
            '请给 "/tmp/demo.mp4" 生成字幕',
            [],
            { type: 'help' }
        );
        assert.deepEqual(result, { type: 'enqueue', videoPath: '/tmp/demo.mp4', autoStart: true });
    });

    it('should keep unquoted paths with spaces intact', () => {
        const result = inferTaskAgentIntent(
            '生成字幕 /Users/wedaren/Downloads/demo folder/sample clip_part005.mp4',
            [],
            { type: 'help' }
        );
        assert.deepEqual(result, {
            type: 'enqueue',
            videoPath: '/Users/wedaren/Downloads/demo folder/sample clip_part005.mp4',
            autoStart: true,
        });
    });

    it('should keep long unquoted paths with CJK and special characters intact', () => {
        const videoPath = '/Users/wedaren/Downloads/SNOS-081-lada•AV01.tv•【LADAモザイク破壊】新人NO.1 STYLE あの話題の超庶民お姉ちゃん 鈴木希21歳 AVデビュー_L1VzZXJz/splits/SNOS-081-lada•AV01.tv•【LADAモザイク破壊】新人NO.1 STYLE あの話題の超庶民お姉ちゃん 鈴木希21歳 AVデビュー_part005.mp4';
        const result = inferTaskAgentIntent(
            `生成字幕 ${videoPath}`,
            [],
            { type: 'help' }
        );
        assert.deepEqual(result, {
            type: 'enqueue',
            videoPath,
            autoStart: true,
        });
    });

    it('should infer retry against the latest failed task', () => {
        const result = inferTaskAgentIntent(
            '重试刚才失败的任务',
            [
                task({ id: 'task_old', videoPath: '/tmp/a.mp4', status: 'failed', updatedAt: '2026-03-14T10:00:00.000Z' }),
                task({ id: 'task_new', videoPath: '/tmp/b.mp4', status: 'failed', updatedAt: '2026-03-15T10:00:00.000Z' }),
            ],
            { type: 'help' }
        );
        assert.deepEqual(result, { type: 'retry', taskId: 'task_new' });
    });

    it('should infer latest task inspection for status requests', () => {
        const result = inferTaskAgentIntent(
            '看看最近任务的状态',
            [
                task({ id: 'task_1', videoPath: '/tmp/a.mp4', status: 'completed', updatedAt: '2026-03-14T10:00:00.000Z' }),
                task({ id: 'task_2', videoPath: '/tmp/b.mp4', status: 'transcribing', updatedAt: '2026-03-15T10:00:00.000Z' }),
            ],
            { type: 'help' }
        );
        assert.deepEqual(result, { type: 'get', taskId: 'task_2' });
    });
});
