/**
 * 任务存储层。
 * 所有任务最终都持久化到 `tasks.json`，由这一层负责读写和状态修正。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskRecord, TaskPhase } from './types';

export class TaskStore {
    private tasks: Map<string, TaskRecord> = new Map();
    private storePath: string = '';
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    async initialize(storageUri: vscode.Uri): Promise<void> {
        // 全部任务数据都放在扩展的 global storage 目录下。
        await vscode.workspace.fs.createDirectory(storageUri);
        this.storePath = path.join(storageUri.fsPath, 'tasks.json');
        await this.load();
    }

    private async load(): Promise<void> {
        try {
            if (fs.existsSync(this.storePath)) {
                const raw = fs.readFileSync(this.storePath, 'utf-8');
                const records: TaskRecord[] = JSON.parse(raw);
                this.tasks.clear();
                for (const r of records) {
                    this.tasks.set(r.id, r);
                }
            }
        } catch {
            // 存储文件损坏时直接回退为空，避免阻塞扩展启动。
            this.tasks.clear();
        }
    }

    private save(): void {
        // 每次保存后都广播变化事件，供视图层刷新。
        const records = Array.from(this.tasks.values());
        fs.writeFileSync(this.storePath, JSON.stringify(records, null, 2), 'utf-8');
        this._onDidChange.fire();
    }

    generateId(): string {
        // 当前用时间戳加短随机串生成任务 ID，足够可读且冲突概率低。
        return `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    generateBatchId(): string {
        // 批次 ID 只要求在当前工作区内可读且冲突概率低。
        return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    addTask(
        videoPath: string,
        config?: { whisperModel?: string; whisperLanguage?: string; targetLanguages?: string[] },
        metadata?: { batchId?: string }
    ): TaskRecord {
        // 新任务统一从 queued 状态开始，实际运行由调度器负责。
        const now = new Date().toISOString();
        const record: TaskRecord = {
            id: this.generateId(),
            videoPath,
            createdAt: now,
            status: 'queued',
            currentPhase: 'queued',
            updatedAt: now,
            batchId: metadata?.batchId,
            outputs: { translated: {} },
            config: config
        };
        this.tasks.set(record.id, record);
        this.save();
        return record;
    }

    updateTask(id: string, updates: Partial<Omit<TaskRecord, 'id'>>): TaskRecord | undefined {
        // 所有更新都会刷新 updatedAt，方便排序与排查。
        const task = this.tasks.get(id);
        if (!task) { return undefined; }
        Object.assign(task, updates, { updatedAt: new Date().toISOString() });
        this.tasks.set(id, task);
        this.save();
        return task;
    }

    getTask(id: string): TaskRecord | undefined {
        return this.tasks.get(id);
    }

    getAllTasks(): TaskRecord[] {
        return Array.from(this.tasks.values());
    }

    removeTask(id: string): boolean {
        const deleted = this.tasks.delete(id);
        if (deleted) { this.save(); }
        return deleted;
    }

    /**
     * 清理源视频已经不存在的任务。
     * 返回被清理的任务数量。
     */
    cleanStaleTasks(): number {
        let count = 0;
        for (const [id, task] of this.tasks) {
            if (!fs.existsSync(task.videoPath)) {
                this.tasks.delete(id);
                count++;
            }
        }
        if (count > 0) { this.save(); }
        return count;
    }

    /**
     * 校正输出文件状态。
     * 如果用户在扩展外手动删除了产物文件，这里会同步把记录中的路径清掉。
     */
    refreshOutputStatus(): void {
        let changed = false;
        for (const task of this.tasks.values()) {
            if (task.outputs.raw && !fs.existsSync(task.outputs.raw)) {
                task.outputs.raw = undefined;
                changed = true;
            }
            if (task.outputs.llm && !fs.existsSync(task.outputs.llm)) {
                task.outputs.llm = undefined;
                changed = true;
            }
            if (task.outputs.folder && !fs.existsSync(task.outputs.folder)) {
                task.outputs.folder = undefined;
                changed = true;
            }
            if (task.outputs.finalSrt && !fs.existsSync(task.outputs.finalSrt)) {
                task.outputs.finalSrt = undefined;
                changed = true;
            }
            if (task.outputs.log && !fs.existsSync(task.outputs.log)) {
                task.outputs.log = undefined;
                changed = true;
            }
            if (task.outputs.config && !fs.existsSync(task.outputs.config)) {
                task.outputs.config = undefined;
                changed = true;
            }
            for (const [lang, filePath] of Object.entries(task.outputs.translated)) {
                if (!fs.existsSync(filePath)) {
                    delete task.outputs.translated[lang];
                    changed = true;
                }
            }
        }
        if (changed) { this.save(); }
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
