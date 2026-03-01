/**
 * TaskTreeItem: TreeItem subclass for task nodes and output file nodes.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskRecord, TaskPhase } from '../types';

const STATUS_ICONS: Record<TaskPhase, vscode.ThemeIcon> = {
    queued: new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow')),
    transcribing: new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue')),
    optimizing: new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.purple')),
    translating: new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.orange')),
    completed: new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green')),
    failed: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
    paused: new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow')),
};

const STATUS_LABELS: Record<TaskPhase, string> = {
    queued: '⏳ Queued',
    transcribing: '🎙 Transcribing',
    optimizing: '✨ Optimizing',
    translating: '🌍 Translating',
    completed: '✅ Completed',
    failed: '❌ Failed',
    paused: '⏸ Paused',
};

export class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: TaskRecord,
        public readonly isOutputFile: boolean = false,
        public readonly filePath?: string,
        public readonly fileLabel?: string
    ) {
        // For output file nodes
        if (isOutputFile && filePath) {
            super(fileLabel || path.basename(filePath), vscode.TreeItemCollapsibleState.None);
            try {
                if (fs.existsSync(filePath) && fs.lstatSync(filePath).isDirectory()) {
                    this.iconPath = new vscode.ThemeIcon('folder');
                    this.command = {
                        command: 'revealFileInOS',
                        title: 'Open Folder',
                        arguments: [vscode.Uri.file(filePath)],
                    };
                    this.resourceUri = vscode.Uri.file(filePath);
                    this.contextValue = 'taskOutputFolder';
                    return;
                }
            } catch (e) {
                // ignore and fallback to file behavior
            }

            this.iconPath = new vscode.ThemeIcon('file');
            this.command = {
                command: 'vscode.open',
                title: 'Open Subtitle File',
                arguments: [vscode.Uri.file(filePath)],
            };
            this.contextValue = 'taskOutput';
            this.resourceUri = vscode.Uri.file(filePath);
            return;
        }

        // For task (video) nodes
        const videoName = path.basename(task.videoPath, path.extname(task.videoPath));
        const statusLabel = STATUS_LABELS[task.status] || task.status;
        super(`${videoName} — ${statusLabel}`, vscode.TreeItemCollapsibleState.Collapsed);

        this.iconPath = STATUS_ICONS[task.status] || new vscode.ThemeIcon('circle-outline');
        this.contextValue = task.status === 'failed' ? 'taskFailed' : 'task';
        this.id = task.id;

        // Tooltip
        const tooltipLines = [
            `Video: ${task.videoPath}`,
            `Status: ${statusLabel}`,
            `Phase: ${task.currentPhase}`,
            `Updated: ${task.updatedAt}`,
        ];
        if (task.lastError) {
            tooltipLines.push(`Error: ${task.lastError}`);
        }
        if (task.complianceHits) {
            tooltipLines.push(`Compliance hits: ${task.complianceHits}`);
        }
        this.tooltip = new vscode.MarkdownString(tooltipLines.join('  \n'));
    }
}
