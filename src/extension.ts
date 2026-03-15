/**
 * 扩展入口。
 * 负责完成以下工作：
 * 1. 创建日志器；
 * 2. 初始化任务存储；
 * 3. 装配所有核心服务；
 * 4. 构建统一公共 API；
 * 5. 注册侧边栏视图、命令和 Copilot agent；
 * 6. 在停用时回收资源。
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
import { SubtitleFlowExtensionExports } from './publicApi';
import { SubtitleFlowApiService } from './services/subtitleFlowApi';
import { ArtifactMigrationService } from './services/artifactMigrationService';
import { registerSubtitleFlowTools } from './copilot/tools';
import { registerSubtitleFlowParticipant } from './copilot/participant';
import { SubtitleFlowAgentHostService, SubtitleFlowExtensionExportsService } from './agent-host';
import { SUBTITLE_FLOW_AGENT_MANIFESTS } from './subtitleFlowRegistry';

let scheduler: TaskScheduler | undefined;
let logger: Logger | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<SubtitleFlowExtensionExports> {
    // ── 0. 最先创建日志器，便于后续初始化过程全部可追踪 ──
    logger = new Logger();
    logger.info('Subtitle Flow extension activating...');
    logger.info(`Global storage path: ${context.globalStorageUri.fsPath}`);

    // ── 1. 初始化任务存储并恢复历史任务 ──
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

    // ── 2. 装配核心服务层 ──
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
    const api = new SubtitleFlowApiService(
        taskStore,
        scheduler,
        pipelineRunner,
        whisperService,
        optimizeService,
        translateService,
        complianceService,
        logger,
        context.extensionPath
    );
    const migrationService = new ArtifactMigrationService(taskStore, logger);
    const agentHost = new SubtitleFlowAgentHostService(api, SUBTITLE_FLOW_AGENT_MANIFESTS);
    const extensionExports = new SubtitleFlowExtensionExportsService(api, agentHost);
    logger.info('All services created.');

    // ── 3. 注册任务树视图 ──
    const treeProvider = new TaskTreeDataProvider(taskStore);
    const treeView = vscode.window.createTreeView('subtitleFlowTasks', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    await vscode.commands.executeCommand('setContext', 'subtitleFlow.viewMode', treeProvider.getViewMode());
    scheduler.onDidChange(() => treeProvider.refresh());
    api.onDidChangeTasks(() => treeProvider.refresh());

    // ── 4. 注册命令与 Copilot 入口 ──
    registerCommands(context, { api, logger, migrationService, treeProvider });
    registerSubtitleFlowTools(context, api);
    registerSubtitleFlowParticipant(context, api);

    // ── 5. 注册需要释放的对象 ──
    context.subscriptions.push(treeView, treeProvider, taskStore, scheduler, logger);

    logger.info('Subtitle Flow extension activated successfully ✅');
    return extensionExports;
}

export function deactivate() {
    // 停用时优先取消正在运行的后台任务，避免扩展退出后残留执行。
    if (scheduler) {
        scheduler.cancelAll();
    }
    if (logger) {
        logger.info('Subtitle Flow extension deactivating...');
    }
}
