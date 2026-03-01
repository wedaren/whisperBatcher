/**
 * Logger: Provides both VS Code Output Channel logging and per-video file logging.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class Logger {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Subtitle Flow');

    }

    /**
     * Log to the VS Code Output Channel (always visible in Output panel).
     */
    info(msg: string): void {
        const line = `[${new Date().toISOString()}] [INFO] ${msg}`;
        this.outputChannel.appendLine(line);
    }

    warn(msg: string): void {
        const line = `[${new Date().toISOString()}] [WARN] ${msg}`;
        this.outputChannel.appendLine(line);
    }

    error(msg: string): void {
        const line = `[${new Date().toISOString()}] [ERROR] ${msg}`;
        this.outputChannel.appendLine(line);
    }

    /**
     * Create a log file alongside a video, write the initial entry,
     * and also create a single Markdown task file containing YAML frontmatter
     * (configuration) and a fenced `jsonl` code block for appendable logs.
     * Returns the task file path.
     */
    /**
     * Create separate config and log files for a task. Returns their paths.
     */
    createTaskLog(videoPath: string, taskId: string, outputDir?: string): { configFilePath: string, logFilePath: string } {
        const videoDir = outputDir ?? path.dirname(videoPath);
        const videoName = path.basename(videoPath, path.extname(videoPath));
        const configFilePath = path.join(videoDir, `${videoName}.task.json`);
        const logFilePath = path.join(videoDir, `${videoName}.log`);

        const config = vscode.workspace.getConfiguration('subtitleFlow');
        const configToSave = JSON.parse(JSON.stringify(config));

        const frontObj = { title: `Task: ${videoName}`, taskId, video: videoName, config: configToSave };

        // Atomic write config file (JSON) (if not exists)
        if (!fs.existsSync(configFilePath)) {
            try {
                const tmp = path.join(videoDir, `.tmp-${Date.now()}.json`);
                fs.writeFileSync(tmp, JSON.stringify(frontObj, null, 2), 'utf-8');
                fs.renameSync(tmp, configFilePath);
                this.info(`Task config created: ${configFilePath}`);
            } catch (e) {
                this.outputChannel.appendLine(`[ERROR] Failed to create config file: ${e}`);
            }
        } else {
            this.info(`Task config exists: ${configFilePath}`);
        }

        // Atomic write initial log entry (if not exists) — plain text lines
        if (!fs.existsSync(logFilePath)) {
            try {
                const initialLogEntry = `[${new Date().toISOString()}] [INFO] Task created`;
                const tmp = path.join(videoDir, `.tmp-${Date.now()}.log`);
                fs.writeFileSync(tmp, initialLogEntry + '\n', 'utf-8');
                fs.renameSync(tmp, logFilePath);
                this.info(`Task log created: ${logFilePath}`);
            } catch (e) {
                this.outputChannel.appendLine(`[ERROR] Failed to create log file: ${e}`);
            }
        } else {
            this.info(`Task log exists: ${logFilePath}`);
        }

        return { configFilePath, logFilePath };
    }

    /**
     * Create a log function that writes to both the per-video log file
     * and the VS Code Output Channel.
     */
    createTaskLogFn(videoPath: string, taskId: string, outputDir?: string): (msg: string) => void {
        const videoDir = outputDir ?? path.dirname(videoPath);
        const videoName = path.basename(videoPath, path.extname(videoPath));
        const logFilePath = path.join(videoDir, `${videoName}.log`);
        const shortId = taskId.substring(taskId.length - 8);

        const maxBytes = vscode.workspace.getConfiguration('subtitleFlow').get<number>('logMaxBytes', 5 * 1024 * 1024);

        const rotateIfNeeded = (filePath: string) => {
            try {
                const st = fs.statSync(filePath);
                if (st.size > maxBytes) {
                    const rotated = `${filePath}.${Date.now()}.rotated.log`;
                    fs.renameSync(filePath, rotated);
                    const rotatedEntry = `[${new Date().toISOString()}] [INFO] Log rotated`;
                    const tmp = path.join(videoDir, `.tmp-${Date.now()}.log`);
                    fs.writeFileSync(tmp, rotatedEntry + '\n', 'utf-8');
                    fs.renameSync(tmp, filePath);
                }
            } catch (e) {
                // ignore
            }
        };

        const appendLogAtomic = (filePath: string, line: string) => {
            try {
                const toAppend = line + '\n';
                const tmp = path.join(videoDir, `.tmp-${Date.now()}.log`);
                let raw = '';
                try { raw = fs.readFileSync(filePath, 'utf-8'); } catch (e) { raw = ''; }
                fs.writeFileSync(tmp, raw + toAppend, 'utf-8');
                fs.renameSync(tmp, filePath);
            } catch (err: any) {
                this.outputChannel.appendLine(`[ERROR] Failed to append to task log: ${err.message}`);
            }
        };

        return (msg: string) => {
            const timestamp = new Date().toISOString();
            const line = `[${timestamp}] [INFO] ${msg}`;

            // Ensure log file exists
            if (!fs.existsSync(logFilePath)) {
                try {
                    this.createTaskLog(videoPath, taskId, outputDir);
                } catch (e) {
                    this.outputChannel.appendLine(`[ERROR] Failed to create task files: ${e}`);
                }
            }

            // Rotate if needed
            rotateIfNeeded(logFilePath);

            // Append atomically (plain text)
            appendLogAtomic(logFilePath, line);

            // Also write to Output Channel (short id)
            this.outputChannel.appendLine(`[${shortId}] ${msg}`);
        };
    }

    /**
     * Show the Output Channel to the user.
     */
    show(): void {
        this.outputChannel.show(true);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
