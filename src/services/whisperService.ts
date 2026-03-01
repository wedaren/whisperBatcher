/**
 * WhisperService: Invoke official openai-whisper Python CLI to transcribe video → raw SRT.
 *
 * openai-whisper accepts video files natively and handles its own model downloading.
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class WhisperService {
    /**
     * Transcribe a video using official python whisper.
     * Run: whisper <videoPath> --model <modelName> --output_dir <videoDir> --output_format srt --language auto
     * Returns the absolute path to the generated *.raw.srt file.
     */
    async transcribe(
        videoPath: string,
        options?: { signal?: AbortSignal; logFn?: (msg: string) => void; taskModel?: string; taskLanguage?: string; outputDir?: string }
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

        const rawSrtPath = path.join(outputDir, `${baseName}.${modelSafe}.raw.srt`);

        // Python whisper outputs <basename>.srt in the output_dir
        const whisperOutputPath = path.join(outputDir, `${baseName}.srt`);

        try {
            log(`Starting official Whisper transcription using model: ${whisperModel}${whisperLanguage !== 'auto' ? ` (Language: ${whisperLanguage})` : ''}`);

            const args = [
                videoPath,
                '--model', whisperModel,
                '--output_dir', videoDir,
                '--output_format', 'srt'
            ];

            if (whisperLanguage !== 'auto' && whisperLanguage) {
                args.push('--language', whisperLanguage);
            }

            const modelPath = config.get<string>('whisperModelPath', '');
            if (modelPath) {
                args.push('--model_dir', modelPath);
            }

            log(`Running: ${whisperBinary} ${args.join(' ')}`);
            await this.runWhisper(whisperBinary, args, options?.signal);

            // whisper outputs <video-basename>.srt, rename to *.raw.srt
            if (fs.existsSync(whisperOutputPath)) {
                fs.renameSync(whisperOutputPath, rawSrtPath);
                log(`Whisper output renamed: ${path.basename(whisperOutputPath)} → ${path.basename(rawSrtPath)}`);
            } else {
                // If the file extension logic in whisper changed slightly, search for an srt
                // If not found in outputDir, search there first, then fallback to videoDir
                let candidates = fs.readdirSync(outputDir).filter(
                    (f) => f.startsWith(baseName) && f.endsWith('.srt') && f !== path.basename(rawSrtPath)
                );
                if (candidates.length === 0) {
                    candidates = fs.readdirSync(videoDir).filter(
                        (f) => f.startsWith(baseName) && f.endsWith('.srt') && f !== path.basename(rawSrtPath)
                    );
                }

                if (candidates.length > 0) {
                    const found = fs.existsSync(path.join(outputDir, candidates[0])) ? path.join(outputDir, candidates[0]) : path.join(videoDir, candidates[0]);
                    fs.renameSync(found, rawSrtPath);
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
                    const errTail = stderr.length > 2000 ? stderr.substring(stderr.length - 2000) : stderr;
                    const outTail = stdout.length > 1000 ? stdout.substring(stdout.length - 1000) : stdout;
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
                signal.addEventListener('abort', () => {
                    proc.kill('SIGTERM');
                    reject(new Error('Aborted'));
                });
            }
        });
    }
}
