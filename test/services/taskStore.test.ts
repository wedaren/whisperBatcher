/**
 * TaskStore 单元测试。
 * 覆盖增删改查、持久化和陈旧任务清理等核心行为。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore } from '../../src/taskStore';

describe('TaskStore', () => {
    let store: TaskStore;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskstore-test-'));
        store = new TaskStore();
        const mockUri = { fsPath: tmpDir, scheme: 'file' } as any;
        await store.initialize(mockUri);
    });

    afterEach(() => {
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should add and retrieve a task', () => {
        const task = store.addTask('/path/to/video.mp4');
        assert.ok(task.id);
        assert.equal(task.videoPath, '/path/to/video.mp4');
        assert.equal(task.status, 'queued');

        const retrieved = store.getTask(task.id);
        assert.ok(retrieved);
        assert.equal(retrieved.videoPath, '/path/to/video.mp4');
    });

    it('should list all tasks', () => {
        store.addTask('/video1.mp4');
        store.addTask('/video2.mp4');
        const all = store.getAllTasks();
        assert.equal(all.length, 2);
    });

    it('should update a task', () => {
        const task = store.addTask('/video.mp4');
        store.updateTask(task.id, { status: 'transcribing', currentPhase: 'transcribing' });

        const updated = store.getTask(task.id);
        assert.equal(updated?.status, 'transcribing');
        assert.equal(updated?.currentPhase, 'transcribing');
    });

    it('should remove a task', () => {
        const task = store.addTask('/video.mp4');
        assert.equal(store.removeTask(task.id), true);
        assert.equal(store.getTask(task.id), undefined);
    });

    it('should persist tasks to disk', async () => {
        store.addTask('/video1.mp4');
        store.addTask('/video2.mp4');

        const store2 = new TaskStore();
        const mockUri = { fsPath: tmpDir, scheme: 'file' } as any;
        await store2.initialize(mockUri);

        assert.equal(store2.getAllTasks().length, 2);
        store2.dispose();
    });

    it('should clean stale tasks', () => {
        store.addTask('/nonexistent/video.mp4');
        const count = store.cleanStaleTasks();
        assert.equal(count, 1);
        assert.equal(store.getAllTasks().length, 0);
    });

    it('should keep tasks with existing source files', () => {
        const videoPath = path.join(tmpDir, 'existing.mp4');
        fs.writeFileSync(videoPath, 'fake video');

        store.addTask(videoPath);
        const count = store.cleanStaleTasks();
        assert.equal(count, 0);
        assert.equal(store.getAllTasks().length, 1);
    });
});
