/**
 * TaskTreeDataProvider 测试。
 * 验证列表视图与批次视图使用同一份任务数据，只改变展示层级。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore } from '../../src/taskStore';
import { TaskTreeDataProvider } from '../../src/views/taskTreeProvider';

describe('TaskTreeDataProvider', () => {
    let tmpDir: string;
    let store: TaskStore;
    let provider: TaskTreeDataProvider;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-tree-provider-test-'));
        store = new TaskStore();
        await store.initialize({ fsPath: tmpDir, scheme: 'file' } as any);
        provider = new TaskTreeDataProvider(store);
    });

    afterEach(() => {
        provider.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should show tasks directly in list mode', () => {
        store.addTask('/tmp/a.mp4');
        store.addTask('/tmp/b.mp4');

        const root = provider.getChildren();
        assert.equal(root.length, 2);
        assert.equal(root.every((item) => Boolean(item.task) && !item.batch), true);
    });

    it('should group tasks by batch in batch mode and keep ungrouped tasks visible', () => {
        store.addTask('/tmp/a.mp4', undefined, { batchId: 'batch_1' });
        store.addTask('/tmp/b.mp4', undefined, { batchId: 'batch_1' });
        store.addTask('/tmp/c.mp4');

        provider.setViewMode('batch');
        const root = provider.getChildren();

        assert.equal(root.length, 2);
        assert.equal(root.some((item) => item.batch?.id === 'batch_1'), true);
        assert.equal(root.some((item) => item.batch?.id === 'ungrouped'), true);

        const batchNode = root.find((item) => item.batch?.id === 'batch_1');
        assert.ok(batchNode?.batch);
        const batchChildren = provider.getChildren(batchNode);
        assert.equal(batchChildren.length, 2);
        assert.equal(batchChildren.every((item) => item.task?.batchId === 'batch_1'), true);
    });
});
