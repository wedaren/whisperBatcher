/**
 * PipelineRunner：为单个视频任务协调三阶段流水线。
 * 阶段：转录 → 优化 → 翻译
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskStore } from '../taskStore';
import { WhisperService } from './whisperService';
import { OptimizeService } from './optimizeService';
import { TranslateService } from './translateService';
import { ComplianceService } from './complianceService';
import { Logger } from './logger';
import { OPTIMIZE_CHUNK_SIZE, OPTIMIZE_OVERLAP } from '../constants';
import { buildArtifactLayout } from './artifactLayout';
import { SubtitleExportService } from './subtitleExportService';

export class PipelineRunner {
    private readonly subtitleExportService = new SubtitleExportService();

    constructor(
        private taskStore: TaskStore,
        private whisper: WhisperService,
        private optimize: OptimizeService,
        private translate: TranslateService,
        private compliance: ComplianceService,
        private logger: Logger,
        private extensionPath: string
    ) { }

    /**
     * 执行一个任务的完整流水线。
     * 这条链路是本扩展的核心主流程：
     * 1. 转录；
     * 2. 优化；
     * 3. 翻译。
     * 每一步都会把状态和产物写回 TaskStore。
     */
    async run(
        taskId: string,
        abortController: AbortController
    ): Promise<void> {
        const task = this.taskStore.getTask(taskId);
        if (!task) { throw new Error(`Task ${taskId} not found`); }

        const signal = abortController.signal;

        const config = vscode.workspace.getConfiguration('subtitleFlow');
        const targetLanguages = task.config?.targetLanguages ?? config.get<string[]>('targetLanguages', ['zh-CN', 'en', 'ja']);
        let complianceRulesPath = config.get<string>('complianceRulesPath', '');

        const videoDir = path.dirname(task.videoPath);
        const baseName = path.basename(task.videoPath, path.extname(task.videoPath));
        const taskModel = task.config?.whisperModel ?? config.get<string>('whisperModel', 'tiny');
        const taskLanguage = task.config?.whisperLanguage ?? config.get<string>('whisperLanguage', 'auto');
        const suffix = config.get<string>('outputFolderSuffix', '.subtitle');
        const layout = buildArtifactLayout(task.videoPath, {
            outputDir: path.join(videoDir, `${baseName}${suffix}`),
            whisperModel: taskModel,
            whisperLanguage: taskLanguage,
        });
        const taskOutputDir = layout.outputDir;

        const logFn = this.logger.createTaskLogFn(task.videoPath, taskId, taskOutputDir);

        if (!complianceRulesPath) {
            complianceRulesPath = path.join(this.extensionPath, 'resources', 'default-lexicon.yml');
            logFn(`Using default compliance lexicon: ${complianceRulesPath}`);
        }

        // 确保输出目录存在（不使用单独的 meta 目录）
        if (!fs.existsSync(taskOutputDir)) { fs.mkdirSync(taskOutputDir, { recursive: true }); }

        logFn('流水线已启动');
        logFn(`配置：model=${taskModel}, lang=${taskLanguage}, 目标语言=[${targetLanguages.join(',')}], 并发=${config.get<number>('maxConcurrency', 2)}`);

        // 加载合规规则
        this.compliance.loadRules(complianceRulesPath);
        if (!this.compliance.isLoaded) {
            logFn('警告：合规词表未加载 — 将在无合规规则下运行');
        } else {
            logFn(`合规词表已加载：共 ${this.compliance.ruleCount} 条规则`);
        }

        try {
            // 阶段 1：转录。优先复用已有输出，避免重复计算。
            const rawSrtPath = layout.rawTranscriptPath;
            const rawCachePath = layout.rawCachePath;
            let finalRawSrtPath = rawSrtPath;

            if (!fs.existsSync(layout.rawCacheDir)) {
                fs.mkdirSync(layout.rawCacheDir, { recursive: true });
            }

            if (fs.existsSync(rawCachePath)) {
                this.syncMainArtifact(rawCachePath, rawSrtPath);
                logFn(`阶段 1/3：复用已存在的 Whisper 缓存，跳过转录 → ${path.basename(rawCachePath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: rawSrtPath, folder: taskOutputDir },
                });
            } else if (fs.existsSync(layout.legacyModelRawPath)) {
                // 如果发现旧路径文件，优先迁移到新的输出目录结构。
                try {
                    fs.renameSync(layout.legacyModelRawPath, rawCachePath);
                    this.syncMainArtifact(rawCachePath, rawSrtPath);
                    logFn(`阶段 1/3：将旧版原始字幕迁移到缓存并同步主文件 → ${path.basename(rawCachePath)}`);
                } catch (e: any) {
                    logFn(`警告：无法移动旧版原始字幕（${e.message || String(e)}），将重新转录`);
                    finalRawSrtPath = rawSrtPath;
                }
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: rawSrtPath, folder: taskOutputDir },
                });
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'transcribing',
                    currentPhase: 'transcribing',
                });
                logFn('阶段 1/3：开始 Whisper 转录...');
                await this.whisper.transcribe(task.videoPath, {
                    signal,
                    taskModel,
                    taskLanguage,
                    outputDir: taskOutputDir,
                    outputPath: rawCachePath,
                    logFn,
                });
                this.syncMainArtifact(rawCachePath, rawSrtPath);
                finalRawSrtPath = rawSrtPath;
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: finalRawSrtPath, folder: taskOutputDir },
                });
                logFn(`阶段 1/3：转录完成 → ${path.basename(finalRawSrtPath)}`);
            }

            // 阶段 2：优化。逻辑与转录阶段一致，也会先尝试复用旧产物。
            const llmSrtPath = layout.optimizedSubtitlePath;
            let finalLlmSrtPath = llmSrtPath;
            let currentTask = this.taskStore.getTask(taskId)!;

            if (fs.existsSync(llmSrtPath)) {
                logFn(`阶段 2/3：在输出目录中找到已存在的 LLM 优化字幕，跳過优化 → ${path.basename(llmSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: llmSrtPath, folder: taskOutputDir },
                });
            } else if (fs.existsSync(layout.legacyLlmPath)) {
                try {
                    fs.renameSync(layout.legacyLlmPath, llmSrtPath);
                    logFn(`阶段 2/3：将旧版 LLM 字幕移动到输出目录 → ${path.basename(llmSrtPath)}`);
                } catch (e: any) {
                    logFn(`警告：无法移动旧版 LLM 字幕（${e.message || String(e)}），将重新优化`);
                    finalLlmSrtPath = llmSrtPath;
                }
                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: llmSrtPath, folder: taskOutputDir },
                });
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'optimizing',
                    currentPhase: 'optimizing',
                });
                logFn('阶段 2/3：开始 LLM 优化...');
                const optimizeResult = await this.optimize.optimize(finalRawSrtPath, { signal, logFn, outputPath: llmSrtPath });
                finalLlmSrtPath = optimizeResult.llmSrtPath;
                currentTask = this.taskStore.getTask(taskId)!;

                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: finalLlmSrtPath, folder: taskOutputDir },
                    complianceHits: (currentTask.complianceHits || 0) + optimizeResult.complianceHits,
                });
                logFn(`阶段 2/3：优化完成 → ${path.basename(finalLlmSrtPath)}（合规命中 ${optimizeResult.complianceHits} 次）`);
            }

            // 阶段 3：翻译。翻译结果写回视频目录，便于用户直接取用。
            this.taskStore.updateTask(taskId, {
                status: 'translating',
                currentPhase: 'translating',
            });
            logFn(`阶段 3/3：开始翻译到 [${targetLanguages.join(', ')}]...`);

            const translatedPaths: Record<string, string> = {};
            let translateHits = 0;
            for (const lang of targetLanguages) {
                const translatedPath = layout.translatedPath(lang);
                if (fs.existsSync(translatedPath)) {
                    translatedPaths[lang] = translatedPath;
                    logFn(`阶段 3/3：复用已存在的翻译字幕 → ${path.basename(translatedPath)}`);
                    continue;
                }

                const result = await this.translate.translateToLanguage(
                    finalLlmSrtPath,
                    lang,
                    { signal, logFn, outputDir: taskOutputDir, outputPath: translatedPath, chunkSize: OPTIMIZE_CHUNK_SIZE, overlap: OPTIMIZE_OVERLAP }
                );
                translatedPaths[lang] = result.translatedPath;
                translateHits += result.complianceHits;
            }

            const updatedTask = this.taskStore.getTask(taskId)!;
            const exportResult = await this.subtitleExportService.export({
                videoPath: task.videoPath,
                outputDir: taskOutputDir,
                whisperModel: taskModel,
                whisperLanguage: taskLanguage,
                optimizedSubtitlePath: finalLlmSrtPath,
                translatedPaths,
                existingBilingualAss: updatedTask.outputs.bilingualAss,
                config: task.config,
                logFn,
            });

            this.taskStore.updateTask(taskId, {
                status: 'completed',
                currentPhase: 'completed',
                outputs: {
                    ...updatedTask.outputs,
                    translated: translatedPaths,
                    bilingualAss: exportResult.bilingualAssPaths,
                    folder: taskOutputDir,
                    finalSrt: exportResult.defaultSubtitlePath,
                },
                complianceHits: (updatedTask.complianceHits || 0) + translateHits,
            });

            const translatedFiles = Object.entries(translatedPaths)
                .map(([lang, p]) => `${lang}→${path.basename(p)}`)
                .join(', ');
            logFn(`阶段 3/3：翻译完成 → ${translatedFiles} （合规命中 ${translateHits} 次）`);
            logFn('✅ 所有阶段已成功完成。');
        } catch (err: any) {
            // 统一把异常映射成 paused 或 failed 状态，保证 UI 与持久化状态一致。
            if (signal.aborted) {
                this.taskStore.updateTask(taskId, {
                    status: 'paused',
                    lastError: 'Task was paused/aborted',
                });
                logFn('⏸ 任务已被暂停/中止。');
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'failed',
                    lastError: err.message || String(err),
                });
                logFn(`❌ 失败: ${err.message || String(err)}`);
                if (err.stack) {
                    logFn(`堆栈: ${err.stack}`);
                }
            }
            throw err;
        }
    }

    private syncMainArtifact(sourcePath: string, targetPath: string): void {
        if (sourcePath === targetPath) {
            return;
        }
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.copyFileSync(sourcePath, targetPath);
    }
}
