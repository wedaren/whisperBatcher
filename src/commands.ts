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
import { TaskTreeItem } from './views/taskTreeItem';
import type { TaskTreeDataProvider } from './views/taskTreeProvider';

export interface CommandDependencies {
    api: SubtitleFlowApi;
    logger: Logger;
    treeProvider?: TaskTreeDataProvider;
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
    const { api, logger } = deps;
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
}
