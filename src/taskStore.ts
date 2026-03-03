/**
 * TaskStore: Manages task persistence in tasks.json
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
            // If corrupted, start fresh
            this.tasks.clear();
        }
    }

    private save(): void {
        const records = Array.from(this.tasks.values());
        fs.writeFileSync(this.storePath, JSON.stringify(records, null, 2), 'utf-8');
        this._onDidChange.fire();
    }

    generateId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    addTask(videoPath: string, config?: { whisperModel?: string; whisperLanguage?: string; targetLanguages?: string[] }): TaskRecord {
        const record: TaskRecord = {
            id: this.generateId(),
            videoPath,
            status: 'queued',
            currentPhase: 'queued',
            updatedAt: new Date().toISOString(),
            outputs: { translated: {} },
            config: config
        };
        this.tasks.set(record.id, record);
        this.save();
        return record;
    }

    updateTask(id: string, updates: Partial<Omit<TaskRecord, 'id'>>): TaskRecord | undefined {
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
     * Remove tasks whose source video no longer exists on disk.
     * Returns number of cleaned records.
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
     * Check if output files still exist on disk and update records accordingly.
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
