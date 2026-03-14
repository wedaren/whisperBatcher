/**
 * 任务调度器。
 * 负责以下行为：
 * 1. 并发控制；
 * 2. 启动排队任务；
 * 3. 暂停、恢复、重试任务；
 * 4. 某个任务完成后继续调度下一个任务。
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
        // 并发上限来自工作区配置，允许用户按机器性能调节。
        return vscode.workspace
            .getConfiguration('subtitleFlow')
            .get<number>('maxConcurrency', 2);
    }

    /**
     * 启动所有处于 queued 状态的任务，并遵守并发上限。
     */
    runPending(): void {
        const tasks = this.taskStore.getAllTasks();
        const queued = tasks.filter((t) => t.status === 'queued');

        for (const task of queued) {
            if (this.running.size >= this.maxConcurrency) {
                break;
            }
            this.startTask(task.id);
        }
    }

    /**
     * 将任务放入待执行集合，并在 autoRun 打开时自动尝试启动。
     * 这里延迟一个 tick 再调度，确保任务记录已经写盘。
     */
    enqueue(taskId: string): void {
        const autoRun = vscode.workspace
            .getConfiguration('subtitleFlow')
            .get<boolean>('autoRun', true);

        if (autoRun) {
            // 延迟到下一轮事件循环，避免任务刚创建就被过早读取。
            setTimeout(() => {
                this.runPending();
            }, 100);
        }
    }

    /**
     * 启动单个后台任务。
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
        // 当前有空闲并发槽位时，自动拉起下一个排队任务。
        if (this.running.size >= this.maxConcurrency) { return; }

        const tasks = this.taskStore.getAllTasks();
        const nextQueued = tasks.find((t) => t.status === 'queued');
        if (nextQueued) {
            this.startTask(nextQueued.id);
        }
    }

    /**
     * 暂停正在运行中的任务。
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
     * 恢复一个已暂停任务。
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
     * 在暂停和恢复之间切换。
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
     * 重试失败任务：清空错误信息并重新排队。
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
     * 判断任务当前是否处于运行中。
     */
    isRunning(taskId: string): boolean {
        return this.running.has(taskId);
    }

    /**
     * 取消全部运行中的任务。
     * 扩展停用时会调用这一方法。
     */
    cancelAll(): void {
        // 逐个触发 abort，让下层服务尽快退出。
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
