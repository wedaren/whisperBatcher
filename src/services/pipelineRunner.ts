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

export class PipelineRunner {
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
     * Run the full pipeline for a task. Updates TaskStore at each phase.
     * Returns when completed or throws on failure.
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

        const suffix = config.get<string>('outputFolderSuffix', '.subtitle');
        const folderName = baseName + suffix;
        const taskOutputDir = path.join(videoDir, folderName);

        const logFn = this.logger.createTaskLogFn(task.videoPath, taskId, taskOutputDir);

        if (!complianceRulesPath) {
            complianceRulesPath = path.join(this.extensionPath, 'resources', 'default-lexicon.yml');
            logFn(`Using default compliance lexicon: ${complianceRulesPath}`);
        }

        const taskModel = task.config?.whisperModel ?? config.get<string>('whisperModel', 'tiny');
        const taskLanguage = task.config?.whisperLanguage ?? config.get<string>('whisperLanguage', 'auto');

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
            // Phase 1: Transcribe
            const modelSafe = taskModel.replace(/[^a-zA-Z0-9_-]/g, '_');
            const rawSrtPath = path.join(taskOutputDir, `${baseName}.${modelSafe}.raw.srt`);
            let finalRawSrtPath = rawSrtPath;

            // 也检查旧位置 (videoDir)
            const legacyRaw = path.join(videoDir, `${baseName}.${modelSafe}.raw.srt`);

            if (fs.existsSync(rawSrtPath)) {
                logFn(`阶段 1/3：在输出目录中找到已存在的原始字幕，跳过转录 → ${path.basename(rawSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: rawSrtPath, folder: taskOutputDir },
                });
            } else if (fs.existsSync(legacyRaw)) {
                // 将旧文件移动到输出目录
                fs.renameSync(legacyRaw, rawSrtPath);
                logFn(`阶段 1/3：将旧版原始字幕移动到输出目录 → ${path.basename(rawSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: rawSrtPath, folder: taskOutputDir },
                });
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'transcribing',
                    currentPhase: 'transcribing',
                });
                logFn('阶段 1/3：开始 Whisper 转录...');
                finalRawSrtPath = await this.whisper.transcribe(task.videoPath, { signal, taskModel, taskLanguage, outputDir: taskOutputDir });
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: finalRawSrtPath, folder: taskOutputDir },
                });
                logFn(`阶段 1/3：转录完成 → ${path.basename(finalRawSrtPath)}`);
            }

            // Phase 2: Optimize
            const llmSrtPath = path.join(taskOutputDir, `${baseName}.llm.srt`);
            let finalLlmSrtPath = llmSrtPath;
            let currentTask = this.taskStore.getTask(taskId)!;
            const legacyLlm = path.join(videoDir, `${baseName}.llm.srt`);

            if (fs.existsSync(llmSrtPath)) {
                logFn(`阶段 2/3：在输出目录中找到已存在的 LLM 优化字幕，跳過优化 → ${path.basename(llmSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: llmSrtPath, folder: taskOutputDir },
                });
            } else if (fs.existsSync(legacyLlm)) {
                fs.renameSync(legacyLlm, llmSrtPath);
                logFn(`阶段 2/3：将旧版 LLM 字幕移动到输出目录 → ${path.basename(llmSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: llmSrtPath, folder: taskOutputDir },
                });
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'optimizing',
                    currentPhase: 'optimizing',
                });
                logFn('阶段 2/3：开始 LLM 优化...');
                const optimizeResult = await this.optimize.optimize(finalRawSrtPath, { signal, logFn });
                finalLlmSrtPath = optimizeResult.llmSrtPath;
                currentTask = this.taskStore.getTask(taskId)!;

                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: finalLlmSrtPath, folder: taskOutputDir },
                    complianceHits: (currentTask.complianceHits || 0) + optimizeResult.complianceHits,
                });
                logFn(`阶段 2/3：优化完成 → ${path.basename(finalLlmSrtPath)}（合规命中 ${optimizeResult.complianceHits} 次）`);
            }

            // Phase 3: Translate
            this.taskStore.updateTask(taskId, {
                status: 'translating',
                currentPhase: 'translating',
            });
            logFn(`阶段 3/3：开始翻译到 [${targetLanguages.join(', ')}]...`);

            // 将最终翻译的 SRT 写到视频同级目录 (videoDir)
            // 为确保翻译阶段使用与优化阶段一致的分块参数，显式传入与 OptimizeService 默认相同的
            // chunkSize/overlap（50/5）。如果未来需要使其可配置，可从 extension config 或 task config 中读取。
            const translateResult = await this.translate.translateAll(
                finalLlmSrtPath,
                targetLanguages,
                { signal, logFn, outputDir: videoDir, chunkSize: 50, overlap: 5 }
            );

            const updatedTask = this.taskStore.getTask(taskId)!;
            // pick primary finalSrt as first target language result if available
            const primaryLang = targetLanguages[0];
            const primaryFinal = translateResult.paths[primaryLang] ?? Object.values(translateResult.paths)[0] ?? '';

            // 将 LLM 优化后的 SRT 复制到视频同级，作为 <basename>.srt
            // （替换之前复制翻译结果的行为）
            let primaryCopyPath = '';
            try {
                if (finalLlmSrtPath && fs.existsSync(finalLlmSrtPath)) {
                    primaryCopyPath = path.join(videoDir, `${baseName}.srt`);
                    // overwrite if exists
                    fs.copyFileSync(finalLlmSrtPath, primaryCopyPath);
                    logFn(`已将 LLM 优化字幕复制到视频同级：${path.basename(primaryCopyPath)}`);
                }
            } catch (e: any) {
                logFn(`警告：未能将 LLM 字幕复制到视频同级：${e.message || String(e)}`);
            }

            this.taskStore.updateTask(taskId, {
                status: 'completed',
                currentPhase: 'completed',
                outputs: {
                    ...updatedTask.outputs,
                    translated: translateResult.paths,
                    folder: taskOutputDir,
                    finalSrt: primaryCopyPath || finalLlmSrtPath,
                },
                complianceHits: (updatedTask.complianceHits || 0) + translateResult.totalComplianceHits,
            });

            const translatedFiles = Object.entries(translateResult.paths)
                .map(([lang, p]) => `${lang}→${path.basename(p)}`)
                .join(', ');
            logFn(`阶段 3/3：翻译完成 → ${translatedFiles} （合规命中 ${translateResult.totalComplianceHits} 次）`);
            logFn('✅ 所有阶段已成功完成。');
        } catch (err: any) {
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
}
