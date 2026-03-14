/**
 * 任务树数据提供器。
 * 负责把 TaskStore 中的任务记录和产物文件映射成侧边栏树节点。
 */
import * as vscode from 'vscode';
import { TaskStore } from '../taskStore';
import { TaskTreeItem } from './taskTreeItem';
import { TaskRecord } from '../types';

export class TaskTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

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

    getChildren(element?: TaskTreeItem): TaskTreeItem[] {
        if (!element) {
            // 根节点层级：显示所有任务，按更新时间倒序。
            const tasks = this.taskStore.getAllTasks();
            tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            return tasks.map((task) => new TaskTreeItem(task));
        }

        // 子节点层级：显示某个任务关联的输出文件。
        if (!element.isOutputFile && element.task) {
            return this.getOutputChildren(element.task);
        }

        return [];
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
