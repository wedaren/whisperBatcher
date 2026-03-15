/**
 * 字幕导出服务测试。
 * 验证默认字幕选择与主双语 ASS 生成逻辑已从 PipelineRunner 独立出来。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SubtitleExportService } from '../../src/services/subtitleExportService';

describe('SubtitleExportService', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-export-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should export source optimized subtitle as default when default target is source', async () => {
        const videoPath = path.join(tmpDir, 'demo.mp4');
        const outputDir = path.join(tmpDir, 'demo.subtitle');
        const optimizedPath = path.join(outputDir, '02-optimized-subtitle.srt');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(videoPath, 'demo');
        fs.writeFileSync(optimizedPath, 'optimized');

        const service = new SubtitleExportService();
        const result = await service.export({
            videoPath,
            outputDir,
            optimizedSubtitlePath: optimizedPath,
            translatedPaths: {},
            config: {
                defaultSubtitleLanguage: 'source',
                generateBilingualAss: false,
            },
        });

        assert.equal(fs.readFileSync(result.defaultSubtitlePath, 'utf-8'), 'optimized');
        assert.equal(fs.readFileSync(result.videoCompanionSubtitlePath, 'utf-8'), 'optimized');
        assert.deepEqual(result.bilingualAssPaths, {});
    });

    it('should export translated subtitle as default and create one bilingual ass', async () => {
        const videoPath = path.join(tmpDir, 'demo.mp4');
        const outputDir = path.join(tmpDir, 'demo.subtitle');
        const optimizedPath = path.join(outputDir, '02-optimized-subtitle.srt');
        const translatedPath = path.join(outputDir, '04-translation.zh-CN.srt');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(videoPath, 'demo');
        fs.writeFileSync(optimizedPath, '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n');
        fs.writeFileSync(translatedPath, '1\n00:00:01,000 --> 00:00:02,000\n你好\n');

        const service = new SubtitleExportService();
        const result = await service.export({
            videoPath,
            outputDir,
            optimizedSubtitlePath: optimizedPath,
            translatedPaths: { 'zh-CN': translatedPath },
            config: {
                defaultSubtitleLanguage: 'zh-CN',
                generateBilingualAss: true,
                bilingualTargetLanguage: 'zh-CN',
            },
        });

        assert.equal(fs.readFileSync(result.defaultSubtitlePath, 'utf-8').includes('你好'), true);
        assert.equal(fs.readFileSync(result.videoCompanionSubtitlePath, 'utf-8').includes('你好'), true);
        assert.equal(typeof result.bilingualAssPaths['zh-CN'], 'string');
        assert.equal(fs.existsSync(result.bilingualAssPaths['zh-CN']), true);
    });
});
