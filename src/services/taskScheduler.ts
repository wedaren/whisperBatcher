/**
 * TaskScheduler: Manages concurrency pool, pause/resume/retry.
 */
import * as vscode from 'vscode';
import { TaskStore } from '../taskStore';
import { PipelineRunner } from './pipelineRunner';
import { Logger } from './logger';

interface RunningTask {
    taskId: string;
    abortController: AbortController;
    promise: Promise<void>;
}

export class TaskScheduler {
    private running: Map<string, RunningTask> = new Map();
    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    constructor(
        private taskStore: TaskStore,
        private pipelineRunner: PipelineRunner,
        private logger: Logger
    ) { }

    private get maxConcurrency(): number {
        return vscode.workspace
            .getConfiguration('subtitleFlow')
            .get<number>('maxConcurrency', 2);
    }

    /**
     * Start processing all queued tasks, respecting concurrency limit.
     */
    runPending(): void {
        const tasks = this.taskStore.getAllTasks();
        const queued = tasks.filter((t) => t.status === 'queued');

        // (verbose) suppressed: queue/run counts

        for (const task of queued) {
            if (this.running.size >= this.maxConcurrency) {
                break;
            }
            this.startTask(task.id);
        }
    }

    /**
     * Enqueue and optionally auto-start a task.
     * Uses setImmediate to ensure the task record is fully persisted before trying to run.
     */
    enqueue(taskId: string): void {
        const autoRun = vscode.workspace
            .getConfiguration('subtitleFlow')
            .get<boolean>('autoRun', true);

        // (verbose) enqueue called

        if (autoRun) {
            // Defer to next tick so the task record is fully saved
            setTimeout(() => {
                this.runPending();
            }, 100);
        }
    }

    /**
     * Start a single task in the background.
     */
    private startTask(taskId: string): void {
        if (this.running.has(taskId)) {
            this.logger.warn(`startTask: task ${taskId} is already running, skipping`);
            return;
        }

        const task = this.taskStore.getTask(taskId);
        if (!task) {
            this.logger.error(`startTask: task ${taskId} not found in store`);
            return;
        }

        this.logger.info(`startTask: starting task ${taskId} for video: ${task.videoPath}`);

        const abortController = new AbortController();
        const promise = this.pipelineRunner
            .run(taskId, abortController)
            .then(() => {
                this.logger.info(`startTask: task ${taskId} completed successfully`);
                this.running.delete(taskId);
                this._onDidChange.fire();
                this.scheduleNext();
            })
            .catch((err: any) => {
                this.logger.error(`startTask: task ${taskId} failed: ${err.message || String(err)}`);
                this.running.delete(taskId);
                this._onDidChange.fire();
                this.scheduleNext();
            });

        this.running.set(taskId, { taskId, abortController, promise });
        this._onDidChange.fire();
    }

    private scheduleNext(): void {
        if (this.running.size >= this.maxConcurrency) { return; }

        const tasks = this.taskStore.getAllTasks();
        const nextQueued = tasks.find((t) => t.status === 'queued');
        if (nextQueued) {
            this.startTask(nextQueued.id);
        }
    }

    /**
     * Pause a running task.
     */
    pause(taskId: string): void {
        const running = this.running.get(taskId);
        if (running) {
            this.logger.info(`pause: pausing task ${taskId}`);
            running.abortController.abort();
            this.running.delete(taskId);
            this.taskStore.updateTask(taskId, { status: 'paused' });
            this._onDidChange.fire();
        }
    }

    /**
     * Resume a paused task.
     */
    resume(taskId: string): void {
        const task = this.taskStore.getTask(taskId);
        if (task && task.status === 'paused') {
            this.logger.info(`resume: resuming task ${taskId}`);
            this.taskStore.updateTask(taskId, { status: 'queued' });
            this.runPending();
        }
    }

    /**
     * Toggle pause/resume on a task.
     */
    pauseOrResume(taskId: string): void {
        const task = this.taskStore.getTask(taskId);
        if (!task) { return; }

        if (this.running.has(taskId)) {
            this.pause(taskId);
        } else if (task.status === 'paused') {
            this.resume(taskId);
        }
    }

    /**
     * Retry a failed task.
     */
    retry(taskId: string): void {
        const task = this.taskStore.getTask(taskId);
        if (task && task.status === 'failed') {
            this.logger.info(`retry: retrying task ${taskId}`);
            this.taskStore.updateTask(taskId, {
                status: 'queued',
                lastError: undefined,
            });
            this.runPending();
        }
    }

    /**
     * Check if a task is currently running.
     */
    isRunning(taskId: string): boolean {
        return this.running.has(taskId);
    }

    /**
     * Cancel all running tasks (used on deactivate).
     */
    cancelAll(): void {
        // cancelling all running tasks
        for (const [, running] of this.running) {
            running.abortController.abort();
        }
        this.running.clear();
    }

    dispose(): void {
        this.cancelAll();
        this._onDidChange.dispose();
    }
}
