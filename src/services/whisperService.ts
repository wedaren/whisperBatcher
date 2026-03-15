/**
 * Whisper 转录服务。
 * 负责调用本地 `openai-whisper` CLI，把视频文件转成原始 SRT。
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { WHISPER_STDERR_LIMIT, WHISPER_STDOUT_LIMIT } from '../constants';

export class WhisperService {
    /**
     * 使用官方 Python whisper CLI 转录视频。
     * 典型命令形态：
     * `whisper <videoPath> --model <modelName> --output_dir <dir> --output_format srt`
     * 返回生成后的 `*.raw.srt` 绝对路径。
     */
    async transcribe(
        videoPath: string,
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; taskModel?: string; taskLanguage?: string; outputDir?: string; outputPath?: string }
    ): Promise<string> {
        const log = options?.logFn ?? (() => { });
        const config = vscode.workspace.getConfiguration('subtitleFlow');

        const whisperBinary = config.get<string>('whisperBinary', 'whisper');
        const whisperModel = options?.taskModel ?? config.get<string>('whisperModel', 'tiny');
        const whisperLanguage = options?.taskLanguage ?? config.get<string>('whisperLanguage', 'auto');

        const videoDir = path.dirname(videoPath);
        const baseName = path.basename(videoPath, path.extname(videoPath));
        const modelSafe = whisperModel.replace(/[^a-zA-Z0-9_-]/g, '_');
        const outputDir = options?.outputDir ?? videoDir;
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const rawSrtPath = options?.outputPath ?? path.join(outputDir, `${baseName}.${modelSafe}.raw.srt`);

        // whisper 默认输出 `<basename>.srt`，稍后会统一改名为 `*.raw.srt`。
        const whisperOutputPath = path.join(outputDir, `${baseName}.srt`);

        try {
            log(`开始执行 Whisper 转录，模型=${whisperModel}${whisperLanguage !== 'auto' ? `，语言=${whisperLanguage}` : ''}`);

            const args = [
                videoPath,
                '--model', whisperModel,
                '--output_dir', outputDir,
                '--output_format', 'srt'
            ];

            if (whisperLanguage !== 'auto' && whisperLanguage) {
                args.push('--language', whisperLanguage);
            }

            const modelPath = config.get<string>('whisperModelPath', '');
            if (modelPath) {
                args.push('--model_dir', modelPath);
            }

            log(`执行命令：${whisperBinary} ${args.join(' ')}`);
            await this.runWhisper(whisperBinary, args, options?.signal);

            // whisper 默认产出 `<basename>.srt`，这里统一改名成 `*.raw.srt`。
            if (fs.existsSync(whisperOutputPath)) {
                fs.renameSync(whisperOutputPath, rawSrtPath);
                log(`Whisper 输出已重命名：${path.basename(whisperOutputPath)} → ${path.basename(rawSrtPath)}`);
            } else {
                // 兼容 whisper 输出逻辑有轻微变化时的兜底搜索。
                log(`未在预期位置找到 Whisper 输出：${whisperOutputPath}`);
                let candidates = fs.readdirSync(outputDir).filter(
                    (f) => f.startsWith(baseName) && f.endsWith('.srt') && f !== path.basename(rawSrtPath)
                );
                log(`输出目录扫描结果：${outputDir} -> [${candidates.join(', ')}]`);
                if (candidates.length === 0) {
                    candidates = fs.readdirSync(videoDir).filter(
                        (f) => f.startsWith(baseName) && f.endsWith('.srt') && f !== path.basename(rawSrtPath)
                    );
                    log(`视频目录扫描结果：${videoDir} -> [${candidates.join(', ')}]`);
                }

                if (candidates.length > 0) {
                    const found = fs.existsSync(path.join(outputDir, candidates[0])) ? path.join(outputDir, candidates[0]) : path.join(videoDir, candidates[0]);
                    fs.renameSync(found, rawSrtPath);
                    log(`通过兜底搜索找到 Whisper 输出：${found}`);
                } else {
                    throw new Error(`Whisper did not produce SRT output for ${videoPath}. Check logs for details.`);
                }
            }

            return rawSrtPath;
        } catch (err: any) {
            throw err;
        }
    }

    private runWhisper(binary: string, args: string[], signal?: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                return reject(new Error('Aborted'));
            }

            // 通过子进程运行外部 CLI，stdout/stderr 用于失败时的诊断信息。
            const proc = cp.spawn(binary, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stderr = '';
            let stdout = '';
            proc.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
            proc.stdout?.on('data', (chunk) => (stdout += chunk.toString()));

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    // 错误输出只保留尾部，避免日志过长。
                    const errTail = stderr.length > WHISPER_STDERR_LIMIT ? stderr.substring(stderr.length - WHISPER_STDERR_LIMIT) : stderr;
                    const outTail = stdout.length > WHISPER_STDOUT_LIMIT ? stdout.substring(stdout.length - WHISPER_STDOUT_LIMIT) : stdout;
                    reject(new Error(
                        `whisper exited with code ${code}.\n` +
                        `stderr (tail): ...\n${errTail}\n` +
                        `stdout (tail): ...\n${outTail}`
                    ));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(
                    `Failed to start ${binary}: ${err.message}.\n` +
                    `Is openai-whisper installed? Try: pip install -U openai-whisper`
                ));
            });

            if (signal) {
                // 外部中断时尽量优雅终止子进程。
                signal.addEventListener('abort', () => {
                    proc.kill('SIGTERM');
                    reject(new Error('Aborted'));
                });
            }
        });
    }
}
