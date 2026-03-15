/**
 * 日志服务。
 * 同时负责 VS Code Output Channel 日志和任务级文件日志。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { buildArtifactLayout } from './artifactLayout';

export class Logger {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Subtitle Flow');

    }

    /**
     * 写入 Output Channel。
     * 这里的日志会始终出现在 VS Code 的 Output 面板中。
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
     * 为任务创建配置文件和日志文件。
     * 这两个文件会和任务输出放在同一目录中，方便用户排查。
     */
    createTaskLog(videoPath: string, taskId: string, outputDir?: string): { configFilePath: string, logFilePath: string } {
        const videoDir = outputDir ?? path.dirname(videoPath);
        const videoName = path.basename(videoPath, path.extname(videoPath));
        const layout = buildArtifactLayout(videoPath, { outputDir: videoDir });
        const configFilePath = layout.taskConfigPath;
        const logFilePath = layout.taskLogPath;

        const config = vscode.workspace.getConfiguration('subtitleFlow');
        const configToSave = JSON.parse(JSON.stringify(config));

        const frontObj = { title: `Task: ${videoName}`, taskId, video: videoName, config: configToSave };

        // 使用临时文件 + rename 的方式尽量保证写入原子性。
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

        // 初始化日志文件，同样使用原子写入策略。
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
     * 创建任务级日志函数。
     * 每次调用都会同时写入文件和 Output Channel。
     */
    createTaskLogFn(videoPath: string, taskId: string, outputDir?: string): (msg: string) => void {
        const videoDir = outputDir ?? path.dirname(videoPath);
        const layout = buildArtifactLayout(videoPath, { outputDir: videoDir });
        const logFilePath = layout.taskLogPath;
        const shortId = taskId.substring(taskId.length - 8);

        const maxBytes = vscode.workspace.getConfiguration('subtitleFlow').get<number>('logMaxBytes', 5 * 1024 * 1024);

        const rotateIfNeeded = (filePath: string) => {
            // 日志超出阈值时轮转，避免单个文件无限增长。
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
                // 日志轮转失败不影响主流程。
            }
        };

        const appendLogAtomic = (filePath: string, line: string) => {
            // 先读旧文件再写临时文件，保证写入逻辑简单可控。
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

            // 如果日志文件不存在，先补建。
            if (!fs.existsSync(logFilePath)) {
                try {
                    this.createTaskLog(videoPath, taskId, outputDir);
                } catch (e) {
                    this.outputChannel.appendLine(`[ERROR] Failed to create task files: ${e}`);
                }
            }

            // 写入前先检查是否需要轮转。
            rotateIfNeeded(logFilePath);

            // 以纯文本方式追加日志。
            appendLogAtomic(logFilePath, line);

            // Output Channel 中附带短任务 ID，方便同时观察多个任务。
            this.outputChannel.appendLine(`[${shortId}] ${msg}`);
        };
    }

    /**
     * 主动展示 Output Channel。
     */
    show(): void {
        this.outputChannel.show(true);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
