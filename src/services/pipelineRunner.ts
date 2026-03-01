/**
 * PipelineRunner: Orchestrates the 3-phase pipeline for a single video task.
 * Phases: transcribe → optimize → translate
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

        // Ensure output directory exists (no separate meta directory)
        if (!fs.existsSync(taskOutputDir)) { fs.mkdirSync(taskOutputDir, { recursive: true }); }

        logFn('Pipeline started');
        logFn(`Config: model=${taskModel}, lang=${taskLanguage}, targetLangs=[${targetLanguages.join(',')}], concurrency=${config.get<number>('maxConcurrency', 2)}`);

        // Load compliance rules
        this.compliance.loadRules(complianceRulesPath);
        if (!this.compliance.isLoaded) {
            logFn('WARNING: Compliance lexicon not loaded — running without compliance rules');
        } else {
            logFn(`Compliance lexicon loaded: ${this.compliance.ruleCount} rules`);
        }

        try {
            // Phase 1: Transcribe
            const modelSafe = taskModel.replace(/[^a-zA-Z0-9_-]/g, '_');
            const rawSrtPath = path.join(taskOutputDir, `${baseName}.${modelSafe}.raw.srt`);
            let finalRawSrtPath = rawSrtPath;

            // Check legacy location as well (videoDir)
            const legacyRaw = path.join(videoDir, `${baseName}.${modelSafe}.raw.srt`);

            if (fs.existsSync(rawSrtPath)) {
                logFn(`Phase 1/3: Found existing raw subtitles in meta, skipping transcription → ${path.basename(rawSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: rawSrtPath, folder: taskOutputDir },
                });
            } else if (fs.existsSync(legacyRaw)) {
                // move legacy into meta
                fs.renameSync(legacyRaw, rawSrtPath);
                logFn(`Phase 1/3: Moved legacy raw subtitle into outputs: ${path.basename(rawSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: rawSrtPath, folder: taskOutputDir },
                });
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'transcribing',
                    currentPhase: 'transcribing',
                });
                logFn('Phase 1/3: Starting Whisper transcription...');
                finalRawSrtPath = await this.whisper.transcribe(task.videoPath, { signal, taskModel, taskLanguage, outputDir: taskOutputDir });
                this.taskStore.updateTask(taskId, {
                    outputs: { ...task.outputs, raw: finalRawSrtPath, folder: taskOutputDir },
                });
                logFn(`Phase 1/3: Transcription complete → ${path.basename(finalRawSrtPath)}`);
            }

            // Phase 2: Optimize
            const llmSrtPath = path.join(taskOutputDir, `${baseName}.llm.srt`);
            let finalLlmSrtPath = llmSrtPath;
            let currentTask = this.taskStore.getTask(taskId)!;
            const legacyLlm = path.join(videoDir, `${baseName}.llm.srt`);

            if (fs.existsSync(llmSrtPath)) {
                logFn(`Phase 2/3: Found existing optimized subtitles, skipping LLM optimization → ${path.basename(llmSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: llmSrtPath, folder: taskOutputDir },
                });
            } else if (fs.existsSync(legacyLlm)) {
                fs.renameSync(legacyLlm, llmSrtPath);
                logFn(`Phase 2/3: Moved legacy llm subtitle into outputs: ${path.basename(llmSrtPath)}`);
                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: llmSrtPath, folder: taskOutputDir },
                });
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'optimizing',
                    currentPhase: 'optimizing',
                });
                logFn('Phase 2/3: Starting LLM optimization...');
                const optimizeResult = await this.optimize.optimize(finalRawSrtPath, { signal, logFn });
                finalLlmSrtPath = optimizeResult.llmSrtPath;
                currentTask = this.taskStore.getTask(taskId)!;

                this.taskStore.updateTask(taskId, {
                    outputs: { ...currentTask.outputs, llm: finalLlmSrtPath, folder: taskOutputDir },
                    complianceHits: (currentTask.complianceHits || 0) + optimizeResult.complianceHits,
                });
                logFn(`Phase 2/3: Optimization complete → ${path.basename(finalLlmSrtPath)} (${optimizeResult.complianceHits} compliance hits)`);
            }

            // Phase 3: Translate
            this.taskStore.updateTask(taskId, {
                status: 'translating',
                currentPhase: 'translating',
            });
            logFn(`Phase 3/3: Starting translation to [${targetLanguages.join(', ')}]...`);

            // Write final translated SRTs next to the original video (videoDir)
            const translateResult = await this.translate.translateAll(
                finalLlmSrtPath,
                targetLanguages,
                { signal, logFn, outputDir: videoDir }
            );

            const updatedTask = this.taskStore.getTask(taskId)!;
            // pick primary finalSrt as first target language result if available
            const primaryLang = targetLanguages[0];
            const primaryFinal = translateResult.paths[primaryLang] ?? Object.values(translateResult.paths)[0] ?? '';

            // Copy LLM-optimized SRT next to video as <basename>.srt
            // (Replaces previous behavior which copied the translated SRT)
            let primaryCopyPath = '';
            try {
                if (finalLlmSrtPath && fs.existsSync(finalLlmSrtPath)) {
                    primaryCopyPath = path.join(videoDir, `${baseName}.srt`);
                    // overwrite if exists
                    fs.copyFileSync(finalLlmSrtPath, primaryCopyPath);
                    logFn(`Copied LLM SRT to video dir: ${path.basename(primaryCopyPath)}`);
                }
            } catch (e: any) {
                logFn(`Warning: failed to copy LLM SRT to video dir: ${e.message || String(e)}`);
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
            logFn(`Phase 3/3: Translation complete → ${translatedFiles} (${translateResult.totalComplianceHits} compliance hits)`);
            logFn('✅ All phases completed successfully.');
        } catch (err: any) {
            if (signal.aborted) {
                this.taskStore.updateTask(taskId, {
                    status: 'paused',
                    lastError: 'Task was paused/aborted',
                });
                logFn('⏸ Task paused/aborted by user.');
            } else {
                this.taskStore.updateTask(taskId, {
                    status: 'failed',
                    lastError: err.message || String(err),
                });
                logFn(`❌ FAILED: ${err.message || String(err)}`);
                if (err.stack) {
                    logFn(`Stack: ${err.stack}`);
                }
            }
            throw err;
        }
    }
}
