/**
 * Command handlers for Subtitle Flow extension.
 * Extracted from extension.ts to keep activate() focused on wiring.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { VIDEO_EXTENSIONS } from './constants';
import { TaskStore } from './taskStore';
import { TaskScheduler } from './services/taskScheduler';
import { Logger } from './services/logger';
import { TaskTreeItem } from './views/taskTreeItem';

export interface CommandDependencies {
    taskStore: TaskStore;
    scheduler: TaskScheduler;
    logger: Logger;
}

export function registerCommands(
    context: vscode.ExtensionContext,
    deps: CommandDependencies
): void {
    const { taskStore, scheduler, logger } = deps;

    // Add Videos
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.addVideos', async () => {
            logger.info('Command: addVideos triggered');

            const uris = await vscode.window.showOpenDialog({
                canSelectMany: true,
                canSelectFiles: true,
                canSelectFolders: false,
                filters: {
                    'Video Files': [...VIDEO_EXTENSIONS],
                    'All Files': ['*'],
                },
                title: 'Select video files for subtitle generation',
            });

            if (!uris || uris.length === 0) {
                logger.info('addVideos: user cancelled or selected nothing');
                return;
            }

            logger.info(`addVideos: user selected ${uris.length} file(s)`);

            // Prompt for Whisper Model
            const globalModel = vscode.workspace.getConfiguration('subtitleFlow').get<string>('whisperModel', 'tiny');
            const modelLabel = await vscode.window.showQuickPick(
                [
                    { label: `Default (Global: ${globalModel})`, value: undefined },
                    { label: '$(symbol-event) tiny', value: 'tiny', description: 'Fastest, lowest accuracy' },
                    { label: '$(symbol-event) base', value: 'base' },
                    { label: '$(symbol-event) small', value: 'small' },
                    { label: '$(symbol-event) medium', value: 'medium', description: 'Good balance' },
                    { label: '$(symbol-event) large-v2', value: 'large-v2' },
                    { label: '$(symbol-event) large-v3', value: 'large-v3', description: 'Slowest, highest accuracy' },
                ],
                { placeHolder: 'Select Whisper Model for this task batch', ignoreFocusOut: true }
            );

            if (!modelLabel) {
                return;
            }

            // Prompt for Whisper Source Language
            const globalSourceLang = vscode.workspace.getConfiguration('subtitleFlow').get<string>('whisperLanguage', 'auto');
            const sourceLangLabel = await vscode.window.showQuickPick(
                [
                    { label: `Default (Global: ${globalSourceLang})`, value: undefined },
                    { label: '$(symbol-event) Auto Detect (auto)', value: 'auto' },
                    { label: '$(symbol-event) Chinese (zh)', value: 'zh' },
                    { label: '$(symbol-event) English (en)', value: 'en' },
                    { label: '$(symbol-event) Japanese (ja)', value: 'ja' },
                    { label: '$(symbol-event) Korean (ko)', value: 'ko' },
                    { label: '$(symbol-event) French (fr)', value: 'fr' },
                    { label: '$(symbol-event) German (de)', value: 'de' },
                    { label: '$(symbol-event) Spanish (es)', value: 'es' },
                    { label: '$(symbol-event) Russian (ru)', value: 'ru' },
                    { label: '$(symbol-event) Italian (it)', value: 'it' },
                ],
                { placeHolder: 'Select Source spoken language for Whisper', ignoreFocusOut: true }
            );

            if (!sourceLangLabel) {
                return;
            }

            // Prompt for Target Languages
            const globalLangs = vscode.workspace.getConfiguration('subtitleFlow').get<string[]>('targetLanguages', ['zh-CN', 'en', 'ja']);
            const langsString = await vscode.window.showInputBox(
                {
                    prompt: 'Target languages (comma separated BCP-47 codes)',
                    value: globalLangs.join(', '),
                    ignoreFocusOut: true
                }
            );

            if (langsString === undefined) {
                return;
            }

            const targetLanguages = langsString.split(',').map(l => l.trim()).filter(l => l.length > 0);
            const taskConfig = {
                whisperModel: modelLabel.value,
                whisperLanguage: sourceLangLabel.value,
                targetLanguages: targetLanguages.length > 0 ? targetLanguages : undefined
            };

            let addedCount = 0;
            for (const uri of uris) {
                const videoPath = uri.fsPath;
                logger.info(`addVideos: creating task for ${videoPath}`);

                const task = taskStore.addTask(videoPath, taskConfig);

                const videoDir = path.dirname(videoPath);
                const baseName = path.basename(videoPath, path.extname(videoPath));
                const suffix = vscode.workspace.getConfiguration('subtitleFlow').get<string>('outputFolderSuffix', '.subtitle');
                const folderName = baseName + suffix;
                const taskOutputDir = path.join(videoDir, folderName);
                try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(taskOutputDir)); } catch (e) { /* ignore */ }

                const { configFilePath, logFilePath } = logger.createTaskLog(videoPath, task.id, taskOutputDir);
                taskStore.updateTask(task.id, { outputs: { ...task.outputs, config: configFilePath, log: logFilePath, folder: taskOutputDir } });

                const logFn = logger.createTaskLogFn(videoPath, task.id, taskOutputDir);
                logFn('Task created and added to queue');
                logFn(`Video: ${videoPath}`);
                if (taskConfig.whisperModel || taskConfig.targetLanguages) {
                    logFn(`Task Config: model=${taskConfig.whisperModel || 'global'}, langs=[${taskConfig.targetLanguages?.join(',') || 'global'}]`);
                }

                scheduler.enqueue(task.id);
                addedCount++;
            }

            vscode.window.showInformationMessage(
                `Subtitle Flow: Added ${addedCount} video(s) to the queue.`
            );
            logger.info(`addVideos: ${addedCount} task(s) created and enqueued`);
            logger.show();
        })
    );

    // Run Pending Tasks
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.runPending', () => {
            logger.info('Command: runPending triggered');
            scheduler.runPending();
            vscode.window.showInformationMessage('Subtitle Flow: Running pending tasks...');
        })
    );

    // Pause / Resume Task
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.pauseResumeTask', (item?: TaskTreeItem) => {
            if (item && item.task) {
                logger.info(`Command: pauseResumeTask for ${item.task.id}`);
                scheduler.pauseOrResume(item.task.id);
            }
        })
    );

    // Retry Failed Task
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.retryTask', (item?: TaskTreeItem) => {
            if (item && item.task) {
                logger.info(`Command: retryTask for ${item.task.id}`);
                scheduler.retry(item.task.id);
            }
        })
    );

    // Reveal in OS
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.revealInOS', (item?: TaskTreeItem) => {
            if (!item) { return; }

            const targetPath = item.filePath || item.task?.videoPath;
            if (targetPath) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
            }
        })
    );

    // Clear Stale Tasks
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.clearStaleTasks', () => {
            logger.info('Command: clearStaleTasks triggered');
            const count = taskStore.cleanStaleTasks();
            taskStore.refreshOutputStatus();
            vscode.window.showInformationMessage(
                `Subtitle Flow: Cleaned ${count} stale task(s).`
            );
        })
    );

    // Delete Task
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.deleteTask', async (item?: TaskTreeItem) => {
            if (item && item.task) {
                const taskId = item.task.id;
                logger.info(`Command: deleteTask for ${taskId}`);

                const confirm = await vscode.window.showWarningMessage(
                    'Are you sure you want to delete this task? (Output files will not be deleted)',
                    { modal: true },
                    'Delete'
                );

                if (confirm === 'Delete') {
                    if (scheduler.isRunning(taskId)) {
                        scheduler.pause(taskId);
                    }
                    taskStore.removeTask(taskId);
                    logger.info(`Deleted task ${taskId}`);
                }
            }
        })
    );
}
