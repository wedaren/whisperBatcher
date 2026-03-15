/**
 * 阶段重建测试。
 * 验证重建前快照、阶段清理和任务重新入队状态。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore } from '../../src/taskStore';
import { Logger } from '../../src/services/logger';
import { ArtifactRebuildService } from '../../src/services/artifactRebuildService';
import { buildArtifactLayout } from '../../src/services/artifactLayout';

describe('ArtifactRebuildService', () => {
    let tmpDir: string;
    let store: TaskStore;
    let logger: Logger;
    let service: ArtifactRebuildService;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-rebuild-test-'));
        store = new TaskStore();
        await store.initialize({ fsPath: tmpDir, scheme: 'file' } as any);
        logger = new Logger();
        service = new ArtifactRebuildService(store, logger);
    });

    afterEach(() => {
        logger.dispose();
        store.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should backup and clear downstream artifacts when rebuilding from optimize', () => {
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
        fs.mkdirSync(layout.rawCacheDir, { recursive: true });
        fs.writeFileSync(layout.rawTranscriptPath, 'raw');
        fs.writeFileSync(layout.rawCachePath, 'raw-cache');
        fs.writeFileSync(layout.optimizedSubtitlePath, 'llm');
        fs.writeFileSync(layout.defaultSubtitlePath, 'default');
        fs.writeFileSync(layout.translatedPath('zh-CN'), 'translated');

        store.updateTask(task.id, {
            status: 'completed',
            currentPhase: 'completed',
            outputs: {
                ...task.outputs,
                folder: layout.outputDir,
                raw: layout.rawTranscriptPath,
                llm: layout.optimizedSubtitlePath,
                finalSrt: layout.defaultSubtitlePath,
                translated: { 'zh-CN': layout.translatedPath('zh-CN') },
            },
        });

        const result = service.prepare(task.id, 'optimize');
        assert.ok(result);
        assert.equal(typeof result.backupDir, 'string');
        assert.equal(fs.existsSync(layout.rawTranscriptPath), true);
        assert.equal(fs.existsSync(layout.optimizedSubtitlePath), false);
        assert.equal(fs.existsSync(layout.defaultSubtitlePath), false);
        assert.equal(fs.existsSync(layout.translatedPath('zh-CN')), false);

        const backupDir = result.backupDir as string;
        assert.equal(fs.existsSync(path.join(backupDir, '02-optimized-subtitle.srt')), true);
        assert.equal(fs.existsSync(path.join(backupDir, '03-default-subtitle.srt')), true);
        assert.equal(fs.existsSync(path.join(backupDir, '04-translation.zh-CN.srt')), true);

        const updated = store.getTask(task.id);
        assert.ok(updated);
        assert.equal(updated.status, 'queued');
        assert.equal(updated.outputs.raw, layout.rawTranscriptPath);
        assert.equal(updated.outputs.llm, undefined);
        assert.equal(updated.outputs.finalSrt, undefined);
        assert.deepEqual(updated.outputs.translated, {});
    });

    it('should backup current raw cache when rebuilding from transcribe', () => {
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
        fs.mkdirSync(layout.rawCacheDir, { recursive: true });
        fs.writeFileSync(layout.rawTranscriptPath, 'raw');
        fs.writeFileSync(layout.rawCachePath, 'raw-cache');

        store.updateTask(task.id, {
            status: 'completed',
            currentPhase: 'completed',
            outputs: {
                ...task.outputs,
                folder: layout.outputDir,
                raw: layout.rawTranscriptPath,
                translated: {},
            },
        });

        const result = service.prepare(task.id, 'transcribe');
        assert.ok(result?.backupDir);
        assert.equal(fs.existsSync(layout.rawTranscriptPath), false);
        assert.equal(fs.existsSync(layout.rawCachePath), false);
        assert.equal(fs.existsSync(path.join(result?.backupDir as string, '01-raw-transcript.srt')), true);
        assert.equal(fs.existsSync(path.join(result?.backupDir as string, 'cache/raw/whisper-tiny.ja.srt')), true);

        const updated = store.getTask(task.id);
        assert.ok(updated);
        assert.equal(updated.outputs.raw, undefined);
    });
});
