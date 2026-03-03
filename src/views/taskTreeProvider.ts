/**
 * TaskTreeDataProvider: Supplies TreeView data for the Subtitle Flow sidebar.
 */
import * as vscode from 'vscode';
import { TaskStore } from '../taskStore';
import { TaskTreeItem } from './taskTreeItem';
import { TaskRecord } from '../types';

export class TaskTreeDataProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private taskStore: TaskStore) {
        // Refresh tree when task store changes
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
            // Root level: show all tasks sorted by updatedAt (newest first)
            const tasks = this.taskStore.getAllTasks();
            tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            return tasks.map((task) => new TaskTreeItem(task));
        }

        // Child level: show output files for a task
        if (!element.isOutputFile && element.task) {
            return this.getOutputChildren(element.task);
        }

        return [];
    }

    private getOutputChildren(task: TaskRecord): TaskTreeItem[] {
        const children: TaskTreeItem[] = [];

        // (removed) combined Markdown task file; config and log are shown separately

        // Outputs folder
        if (task.outputs.folder) {
            children.push(new TaskTreeItem(task, true, task.outputs.folder, '📁 Outputs Folder'));
        }

        // Final user-facing SRT
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
