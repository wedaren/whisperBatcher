/**
 * 任务树数据提供器。
 * 负责把 TaskStore 中的任务记录和产物文件映射成侧边栏树节点。
 */
import * as vscode from 'vscode';
import { TaskStore } from '../taskStore';
import { TaskTreeItem } from './taskTreeItem';
import { TaskRecord } from '../types';
import type { BatchSummary } from '../publicApi';

export type TaskTreeViewMode = 'list' | 'batch';

export class TaskTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private viewMode: TaskTreeViewMode = 'list';

    constructor(private taskStore: TaskStore) {
        // 任务存储变化时自动刷新树视图。
        taskStore.onDidChange(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getViewMode(): TaskTreeViewMode {
        return this.viewMode;
    }

    setViewMode(mode: TaskTreeViewMode): void {
        if (this.viewMode === mode) {
            return;
        }
        this.viewMode = mode;
        this.refresh();
    }

    getChildren(element?: TaskTreeItem): TaskTreeItem[] {
        if (!element) {
            return this.viewMode === 'batch'
                ? this.getBatchRootChildren()
                : this.getTaskRootChildren();
        }

        if (element.batch) {
            return this.getTasksForBatch(element.batch.id).map((task) => new TaskTreeItem(task));
        }

        // 子节点层级：显示某个任务关联的输出文件。
        if (!element.isOutputFile && element.task) {
            return this.getOutputChildren(element.task);
        }

        return [];
    }

    private getTaskRootChildren(): TaskTreeItem[] {
        const tasks = this.taskStore.getAllTasks();
        tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return tasks.map((task) => new TaskTreeItem(task));
    }

    private getBatchRootChildren(): TaskTreeItem[] {
        const batches = this.buildBatchSummaries();
        return batches.map((batch) => new TaskTreeItem(undefined, false, undefined, undefined, batch));
    }

    private getTasksForBatch(batchId: string): TaskRecord[] {
        return this.taskStore.getAllTasks()
            .filter((task) => (task.batchId ?? 'ungrouped') === batchId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    private buildBatchSummaries(): BatchSummary[] {
        const groups = new Map<string, TaskRecord[]>();
        for (const task of this.taskStore.getAllTasks()) {
            const bucketId = task.batchId ?? 'ungrouped';
            const bucket = groups.get(bucketId) ?? [];
            bucket.push(task);
            groups.set(bucketId, bucket);
        }

        return Array.from(groups.entries())
            .map(([batchId, tasks]) => this.toBatchSummary(batchId, tasks))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    private toBatchSummary(batchId: string, tasks: TaskRecord[]): BatchSummary {
        const createdAt = tasks
            .map((task) => task.createdAt)
            .slice()
            .sort((left, right) => left.localeCompare(right))[0];
        const updatedAt = tasks
            .map((task) => task.updatedAt)
            .slice()
            .sort((left, right) => right.localeCompare(left))[0];

        return {
            id: batchId,
            createdAt,
            updatedAt,
            taskIds: tasks.map((task) => task.id),
            videoPaths: tasks.map((task) => task.videoPath),
            counts: {
                total: tasks.length,
                queued: tasks.filter((task) => task.status === 'queued').length,
                running: tasks.filter((task) => ['transcribing', 'optimizing', 'translating'].includes(task.status)).length,
                completed: tasks.filter((task) => task.status === 'completed').length,
                failed: tasks.filter((task) => task.status === 'failed').length,
                paused: tasks.filter((task) => task.status === 'paused').length,
            },
        };
    }

    private getOutputChildren(task: TaskRecord): TaskTreeItem[] {
        const children: TaskTreeItem[] = [];

        // 输出目录
        if (task.outputs.folder) {
            children.push(new TaskTreeItem(task, true, task.outputs.folder, '📁 Outputs Folder'));
        }

        // 面向用户的最终字幕文件
        if (task.outputs.finalSrt) {
            children.push(new TaskTreeItem(task, true, task.outputs.finalSrt, '🎯 Final SRT'));
        }

        if (task.outputs.config) {
            children.push(new TaskTreeItem(task, true, task.outputs.config, '⚙️ Task Config'));
        }
        if (task.outputs.log) {
            children.push(new TaskTreeItem(task, true, task.outputs.log, '📄 Execution Log'));
        }
        if (task.outputs.raw) {
            children.push(new TaskTreeItem(task, true, task.outputs.raw, '📝 Raw SRT'));
        }
        if (task.outputs.llm) {
            children.push(new TaskTreeItem(task, true, task.outputs.llm, '✨ Optimized SRT'));
        }

        for (const [lang, filePath] of Object.entries(task.outputs.translated)) {
            children.push(new TaskTreeItem(task, true, filePath, `🌍 ${lang}`));
        }

        return children;
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}
