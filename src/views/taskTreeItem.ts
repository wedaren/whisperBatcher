/**
 * 任务树节点。
 * 同时承担两类展示职责：
 * 1. 任务节点；
 * 2. 输出文件节点。
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
    queued: '⏳ 排队中',
    transcribing: '🎙 转录中',
    optimizing: '✨ 优化中',
    translating: '🌍 翻译中',
    completed: '✅ 已完成',
    failed: '❌ 已失败',
    paused: '⏸ 已暂停',
};

export class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: TaskRecord,
        public readonly isOutputFile: boolean = false,
        public readonly filePath?: string,
        public readonly fileLabel?: string
    ) {
        // 输出文件节点：点击后打开文件，目录节点则在系统文件管理器中显示。
        if (isOutputFile && filePath) {
            super(fileLabel || path.basename(filePath), vscode.TreeItemCollapsibleState.None);
            try {
                if (fs.existsSync(filePath) && fs.lstatSync(filePath).isDirectory()) {
                    this.iconPath = new vscode.ThemeIcon('folder');
                    this.command = {
                        command: 'revealFileInOS',
                        title: '打开目录',
                        arguments: [vscode.Uri.file(filePath)],
                    };
                    this.resourceUri = vscode.Uri.file(filePath);
                    this.contextValue = 'taskOutputFolder';
                    return;
                }
            } catch (e) {
                // 出现异常时退回普通文件节点行为。
            }

            this.iconPath = new vscode.ThemeIcon('file');
            this.command = {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [vscode.Uri.file(filePath)],
            };
            this.contextValue = 'taskOutput';
            this.resourceUri = vscode.Uri.file(filePath);
            return;
        }

        // 任务节点：显示视频名和当前任务状态。
        const videoName = path.basename(task.videoPath, path.extname(task.videoPath));
        const statusLabel = STATUS_LABELS[task.status] || task.status;
        super(`${videoName} — ${statusLabel}`, vscode.TreeItemCollapsibleState.Collapsed);

        this.iconPath = STATUS_ICONS[task.status] || new vscode.ThemeIcon('circle-outline');
        this.contextValue = task.status === 'failed' ? 'taskFailed' : 'task';
        this.id = task.id;

        // Tooltip 用于快速展示任务元信息和错误摘要。
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
