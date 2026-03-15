/**
 * VS Code 命令处理层。
 * 这一层只负责和用户交互：采集输入、触发 API、展示提示信息。
 * 真正的任务状态修改和执行编排统一交给 SubtitleFlowApi，
 * 这样命令、Copilot agent 和未来外部扩展可以复用同一套控制面。
 */
import * as vscode from 'vscode';
import { VIDEO_EXTENSIONS } from './constants';
import { Logger } from './services/logger';
import type { SubtitleFlowApi } from './publicApi';
import type { ArtifactMigrationService } from './services/artifactMigrationService';
import { TaskTreeItem } from './views/taskTreeItem';
import type { TaskTreeDataProvider } from './views/taskTreeProvider';

export interface CommandDependencies {
    api: SubtitleFlowApi;
    logger: Logger;
    migrationService: ArtifactMigrationService;
    treeProvider?: TaskTreeDataProvider;
}

async function rebuildTaskFromStage(
    api: SubtitleFlowApi,
    logger: Logger,
    item: TaskTreeItem | undefined,
    stage: 'transcribe' | 'optimize' | 'translate'
): Promise<void> {
    if (!item?.task) {
        return;
    }

    const labels = {
        transcribe: '从转录阶段重建',
        optimize: '从优化阶段重建',
        translate: '从翻译阶段重建',
    } as const;

    logger.info(`Command: rebuild ${stage} for ${item.task.id}`);
    const result = await api.rebuildTask(item.task.id, stage);
    if (!result) {
        vscode.window.showWarningMessage('Subtitle Flow: Task not found for rebuild.');
        return;
    }

    const backupSummary = result.backupDir ? `备份已保存到 ${result.backupDir}` : '本次没有可备份的已有产物';
    vscode.window.showInformationMessage(
        `Subtitle Flow: 已${labels[stage]}，清理 ${result.removedPaths.length} 个产物并重新入队。${backupSummary}`
    );
}

/**
 * 注册扩展提供的全部命令。
 * 当前命令分为三类：
 * 1. 创建与启动任务；
 * 2. 控制已有任务；
 * 3. 清理与辅助操作。
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    deps: CommandDependencies
): void {
    const { api, logger, migrationService } = deps;
    const treeProvider = deps.treeProvider;

    // 添加视频并创建批量任务
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

            // 为当前批次临时选择 Whisper 模型
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

            // 为当前批次临时选择源语言
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

            // 为当前批次临时输入目标语言列表
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

            const inputs = uris.map((uri) => ({ videoPath: uri.fsPath }));
            const tasks = await api.enqueueTasks(inputs, taskConfig);
            const addedCount = tasks.length;

            vscode.window.showInformationMessage(
                `Subtitle Flow: Added ${addedCount} video(s) to the queue.`
            );
            logger.info(`addVideos: ${addedCount} task(s) created and enqueued`);
            logger.show();
        })
    );

    // 手动触发所有待执行任务
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.runPending', () => {
            logger.info('Command: runPending triggered');
            api.runPending();
            vscode.window.showInformationMessage('Subtitle Flow: Running pending tasks...');
        })
    );

    // 打开 Copilot agent 聊天入口
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.agent', async () => {
            logger.info('Command: agent triggered');
            await vscode.commands.executeCommand(
                'workbench.action.chat.open',
                '@subtitleFlow'
            );
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.showTaskList', async () => {
            logger.info('Command: showTaskList triggered');
            treeProvider?.setViewMode('list');
            await vscode.commands.executeCommand('setContext', 'subtitleFlow.viewMode', 'list');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.showTaskBatches', async () => {
            logger.info('Command: showTaskBatches triggered');
            treeProvider?.setViewMode('batch');
            await vscode.commands.executeCommand('setContext', 'subtitleFlow.viewMode', 'batch');
        })
    );

    // 暂停或恢复单个任务
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.pauseResumeTask', (item?: TaskTreeItem) => {
            if (item && item.task) {
                logger.info(`Command: pauseResumeTask for ${item.task.id}`);
                if (item.task.status === 'paused') {
                    api.resumeTask(item.task.id);
                } else {
                    api.pauseTask(item.task.id);
                }
            }
        })
    );

    // 重试失败任务
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.retryTask', (item?: TaskTreeItem) => {
            if (item && item.task) {
                logger.info(`Command: retryTask for ${item.task.id}`);
                api.retryTask(item.task.id);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.rebuildFromTranscribe', async (item?: TaskTreeItem) => {
            await rebuildTaskFromStage(api, logger, item, 'transcribe');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.rebuildFromOptimize', async (item?: TaskTreeItem) => {
            await rebuildTaskFromStage(api, logger, item, 'optimize');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.rebuildFromTranslate', async (item?: TaskTreeItem) => {
            await rebuildTaskFromStage(api, logger, item, 'translate');
        })
    );

    // 在系统文件管理器中显示文件或目录
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.revealInOS', (item?: TaskTreeItem) => {
            if (!item) { return; }

            const targetPath = item.filePath || item.task?.videoPath;
            if (targetPath) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
            }
        })
    );

    // 清理源文件已不存在的陈旧任务
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.clearStaleTasks', () => {
            logger.info('Command: clearStaleTasks triggered');
            const count = api.cleanStaleTasks();
            vscode.window.showInformationMessage(
                `Subtitle Flow: Cleaned ${count} stale task(s).`
            );
        })
    );

    // 删除任务记录，但不删除输出文件
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
                    api.deleteTask(taskId);
                    logger.info(`Deleted task ${taskId} via public API`);
                }
            }
        })
    );

    // 迁移历史任务产物到新的语义化布局，不重新执行任务。
    context.subscriptions.push(
        vscode.commands.registerCommand('subtitleFlow.migrateArtifactLayout', async (item?: TaskTreeItem) => {
            const task = item?.task;
            logger.info(task
                ? `Command: migrateArtifactLayout for ${task.id}`
                : 'Command: migrateArtifactLayout for all tasks');

            if (task) {
                const report = migrationService.migrateTask(task.id);
                if (!report) {
                    vscode.window.showWarningMessage('Subtitle Flow: Task not found for artifact migration.');
                    return;
                }
                const message = `Subtitle Flow: Migrated ${report.migrated} file(s), skipped ${report.skipped}, conflicts ${report.conflicted}.`;
                vscode.window.showInformationMessage(message);
                logger.info(`Artifact migration summary for ${task.id}: ${message}`);
                return;
            }

            const summary = migrationService.migrateAllTasks();
            const message = `Subtitle Flow: Migrated ${summary.migrated} file(s) across ${summary.tasks.length} task(s), skipped ${summary.skipped}, conflicts ${summary.conflicted}.`;
            vscode.window.showInformationMessage(message);
            logger.info(`Artifact migration summary for all tasks: ${message}`);
        })
    );
}
