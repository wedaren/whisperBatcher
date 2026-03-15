/**
 * 历史产物迁移测试。
 * 验证旧格式文件迁移到新布局后，任务记录也会同步更新。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore } from '../../src/taskStore';
import { Logger } from '../../src/services/logger';
import { ArtifactMigrationService } from '../../src/services/artifactMigrationService';
import { buildArtifactLayout } from '../../src/services/artifactLayout';

describe('ArtifactMigrationService', () => {
    let tmpDir: string;
    let store: TaskStore;
    let logger: Logger;
    let service: ArtifactMigrationService;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-migration-test-'));
        store = new TaskStore();
        await store.initialize({ fsPath: tmpDir, scheme: 'file' } as any);
        logger = new Logger();
        service = new ArtifactMigrationService(store, logger);
    });

    afterEach(() => {
        logger.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should migrate legacy artifacts into semantic layout and update task outputs', () => {
        const videoDir = path.join(tmpDir, 'videos');
        fs.mkdirSync(videoDir, { recursive: true });
        const videoPath = path.join(videoDir, 'demo.mp4');
        fs.writeFileSync(videoPath, 'demo');

        const task = store.addTask(videoPath, {
            whisperModel: 'tiny',
            whisperLanguage: 'ja',
            targetLanguages: ['zh-CN'],
        });
        const layout = buildArtifactLayout(videoPath, {
            whisperModel: 'tiny',
            whisperLanguage: 'ja',
        });
        fs.mkdirSync(layout.outputDir, { recursive: true });

        const legacyRawPath = path.join(videoDir, 'demo.tiny.raw.srt');
        const legacyLlmPath = path.join(videoDir, 'demo.llm.srt');
        const legacyTranslationPath = path.join(layout.outputDir, 'demo.zh-CN.srt');
        const legacyConfigPath = path.join(layout.outputDir, 'demo.task.json');
        const legacyLogPath = path.join(layout.outputDir, 'demo.log');
        fs.writeFileSync(legacyRawPath, 'raw');
        fs.writeFileSync(legacyLlmPath, 'llm');
        fs.writeFileSync(legacyTranslationPath, 'translated');
        fs.writeFileSync(legacyConfigPath, '{"legacy":true}');
        fs.writeFileSync(legacyLogPath, 'legacy log');

        store.updateTask(task.id, {
            outputs: {
                ...task.outputs,
                folder: layout.outputDir,
                raw: legacyRawPath,
                llm: legacyLlmPath,
                translated: { 'zh-CN': legacyTranslationPath },
                config: legacyConfigPath,
                log: legacyLogPath,
            },
        });

        const report = service.migrateTask(task.id);
        assert.ok(report);
        assert.equal(report.migrated >= 5, true);

        assert.equal(fs.existsSync(layout.rawCachePath), true);
        assert.equal(fs.existsSync(layout.rawTranscriptPath), true);
        assert.equal(fs.existsSync(layout.optimizedSubtitlePath), true);
        assert.equal(fs.existsSync(layout.defaultSubtitlePath), true);
        assert.equal(fs.existsSync(layout.translatedPath('zh-CN')), true);
        assert.equal(fs.existsSync(layout.taskConfigPath), true);
        assert.equal(fs.existsSync(layout.taskLogPath), true);

        const updated = store.getTask(task.id);
        assert.ok(updated);
        assert.equal(updated.outputs.raw, layout.rawTranscriptPath);
        assert.equal(updated.outputs.llm, layout.optimizedSubtitlePath);
        assert.equal(updated.outputs.finalSrt, layout.defaultSubtitlePath);
        assert.equal(updated.outputs.translated['zh-CN'], layout.translatedPath('zh-CN'));
        assert.equal(updated.outputs.config, layout.taskConfigPath);
        assert.equal(updated.outputs.log, layout.taskLogPath);
    });

    it('should skip conflicts without overwriting existing semantic files', () => {
        const videoDir = path.join(tmpDir, 'videos');
        fs.mkdirSync(videoDir, { recursive: true });
        const videoPath = path.join(videoDir, 'demo.mp4');
        fs.writeFileSync(videoPath, 'demo');

        const task = store.addTask(videoPath, {
            whisperModel: 'tiny',
            whisperLanguage: 'ja',
        });
        const layout = buildArtifactLayout(videoPath, {
            whisperModel: 'tiny',
            whisperLanguage: 'ja',
        });
        fs.mkdirSync(layout.outputDir, { recursive: true });

        const legacyLlmPath = path.join(videoDir, 'demo.llm.srt');
        fs.writeFileSync(legacyLlmPath, 'legacy llm');
        fs.writeFileSync(layout.optimizedSubtitlePath, 'new llm');

        store.updateTask(task.id, {
            outputs: {
                ...task.outputs,
                folder: layout.outputDir,
                llm: legacyLlmPath,
                translated: {},
            },
        });

        const report = service.migrateTask(task.id);
        assert.ok(report);
        assert.equal(report.conflicted >= 1, true);
        assert.equal(fs.readFileSync(layout.optimizedSubtitlePath, 'utf-8'), 'new llm');
        assert.equal(fs.existsSync(legacyLlmPath), true);
    });
});
