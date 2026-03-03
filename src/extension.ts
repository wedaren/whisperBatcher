/**
 * Extension entry point: wire all services and register commands.
 */
import * as vscode from 'vscode';
import { TaskStore } from './taskStore';
import { WhisperService } from './services/whisperService';
import { LLMClient } from './services/llmClient';
import { ComplianceService } from './services/complianceService';
import { OptimizeService } from './services/optimizeService';
import { TranslateService } from './services/translateService';
import { PipelineRunner } from './services/pipelineRunner';
import { TaskScheduler } from './services/taskScheduler';
import { TaskTreeDataProvider } from './views/taskTreeProvider';
import { Logger } from './services/logger';
import { registerCommands } from './commands';

let scheduler: TaskScheduler | undefined;
let logger: Logger | undefined;

export async function activate(context: vscode.ExtensionContext) {
    // ── 0. Create Logger (first, so everything can log) ──
    logger = new Logger();
    logger.info('Subtitle Flow extension activating...');
    logger.info(`Global storage path: ${context.globalStorageUri.fsPath}`);

    // ── 1. Initialize Task Store ──
    const taskStore = new TaskStore();
    await taskStore.initialize(context.globalStorageUri);
    logger.info(`Task store initialized. ${taskStore.getAllTasks().length} existing task(s) loaded.`);

    const staleCount = taskStore.cleanStaleTasks();
    if (staleCount > 0) {
        logger.info(`Cleaned ${staleCount} stale task(s) (video files no longer exist).`);
        vscode.window.showInformationMessage(
            `Subtitle Flow: Cleaned ${staleCount} stale task(s) (video files no longer exist).`
        );
    }
    taskStore.refreshOutputStatus();

    // ── 2. Create Services ──
    const whisperService = new WhisperService();
    const llmClient = new LLMClient();
    const complianceService = new ComplianceService();
    const optimizeService = new OptimizeService(llmClient, complianceService);
    const translateService = new TranslateService(llmClient, complianceService);
    const pipelineRunner = new PipelineRunner(
        taskStore, whisperService, optimizeService, translateService,
        complianceService, logger, context.extensionPath
    );
    scheduler = new TaskScheduler(taskStore, pipelineRunner, logger);
    logger.info('All services created.');

    // ── 3. Register TreeView ──
    const treeProvider = new TaskTreeDataProvider(taskStore);
    const treeView = vscode.window.createTreeView('subtitleFlowTasks', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    scheduler.onDidChange(() => treeProvider.refresh());

    // ── 4. Register Commands ──
    registerCommands(context, { taskStore, scheduler, logger });

    // ── 5. Push disposables ──
    context.subscriptions.push(treeView, treeProvider, taskStore, scheduler, logger);

    logger.info('Subtitle Flow extension activated successfully ✅');
}

export function deactivate() {
    if (scheduler) {
        scheduler.cancelAll();
    }
    if (logger) {
        logger.info('Subtitle Flow extension deactivating...');
    }
}
