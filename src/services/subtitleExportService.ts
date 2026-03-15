/**
 * 字幕导出服务。
 *
 * 职责：
 * 1. 根据任务配置决定默认字幕来源；
 * 2. 同步输出目录中的默认字幕主文件；
 * 3. 同步视频同级播放器默认字幕；
 * 4. 按需生成主双语 ASS。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { TaskConfig } from '../types';
import { AssSubtitleService } from './assSubtitleService';
import { buildArtifactLayout } from './artifactLayout';

export interface SubtitleExportInput {
    videoPath: string;
    outputDir?: string;
    whisperModel?: string;
    whisperLanguage?: string;
    optimizedSubtitlePath: string;
    translatedPaths: Record<string, string>;
    existingBilingualAss?: Record<string, string>;
    config?: TaskConfig;
    logFn?: (message: string) => void;
}

export interface SubtitleExportResult {
    defaultSubtitleSourcePath: string;
    defaultSubtitlePath: string;
    videoCompanionSubtitlePath: string;
    bilingualAssPaths: Record<string, string>;
}

export class SubtitleExportService {
    constructor(
        private readonly assSubtitleService: AssSubtitleService = new AssSubtitleService()
    ) {}

    async export(input: SubtitleExportInput): Promise<SubtitleExportResult> {
        const layout = buildArtifactLayout(input.videoPath, {
            outputDir: input.outputDir,
            whisperModel: input.whisperModel,
            whisperLanguage: input.whisperLanguage,
        });
        const log = input.logFn ?? (() => {});
        const defaultSubtitleSourcePath = this.resolveDefaultSubtitleSourcePath(
            input.optimizedSubtitlePath,
            input.translatedPaths,
            input.config?.defaultSubtitleLanguage
        );

        this.copyArtifact(defaultSubtitleSourcePath, layout.defaultSubtitlePath);
        log(`已同步默认字幕主文件：${path.basename(layout.defaultSubtitlePath)}`);

        this.copyArtifact(defaultSubtitleSourcePath, layout.videoCompanionSubtitlePath);
        log(`已将默认字幕复制到视频同级：${path.basename(layout.videoCompanionSubtitlePath)}`);

        const bilingualAssPaths: Record<string, string> = { ...(input.existingBilingualAss ?? {}) };
        const bilingualTargetLanguage = input.config?.generateBilingualAss
            ? input.config?.bilingualTargetLanguage
            : undefined;
        if (bilingualTargetLanguage && input.translatedPaths[bilingualTargetLanguage]) {
            const bilingualAssPath = layout.bilingualAssPath(bilingualTargetLanguage);
            await this.assSubtitleService.createBilingualAss(
                input.optimizedSubtitlePath,
                input.translatedPaths[bilingualTargetLanguage],
                bilingualTargetLanguage,
                bilingualAssPath
            );
            bilingualAssPaths[bilingualTargetLanguage] = bilingualAssPath;
            log(`已生成主双语 ASS：${path.basename(bilingualAssPath)}`);
        }

        return {
            defaultSubtitleSourcePath,
            defaultSubtitlePath: layout.defaultSubtitlePath,
            videoCompanionSubtitlePath: layout.videoCompanionSubtitlePath,
            bilingualAssPaths,
        };
    }

    private resolveDefaultSubtitleSourcePath(
        optimizedSubtitlePath: string,
        translatedPaths: Record<string, string>,
        defaultSubtitleLanguage?: string
    ): string {
        if (!defaultSubtitleLanguage || defaultSubtitleLanguage === 'source') {
            return optimizedSubtitlePath;
        }
        return translatedPaths[defaultSubtitleLanguage] ?? optimizedSubtitlePath;
    }

    private copyArtifact(sourcePath: string, targetPath: string): void {
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
