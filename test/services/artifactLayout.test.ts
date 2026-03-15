/**
 * 产物布局测试。
 * 验证语义化主文件名和 Whisper 缓存路径保持稳定。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifactLayout } from '../../src/services/artifactLayout';

describe('artifactLayout', () => {
    it('should build semantic artifact names and raw cache path', () => {
        const layout = buildArtifactLayout('/tmp/demo clip.mp4', {
            outputDir: '/tmp/demo clip.subtitle',
            whisperModel: 'large-v3',
            whisperLanguage: 'ja',
        });

        assert.equal(layout.rawTranscriptPath, '/tmp/demo clip.subtitle/01-raw-transcript.srt');
        assert.equal(layout.optimizedSubtitlePath, '/tmp/demo clip.subtitle/02-optimized-subtitle.srt');
        assert.equal(layout.defaultSubtitlePath, '/tmp/demo clip.subtitle/03-default-subtitle.srt');
        assert.equal(layout.translatedPath('zh-CN'), '/tmp/demo clip.subtitle/04-translation.zh-CN.srt');
        assert.equal(layout.taskConfigPath, '/tmp/demo clip.subtitle/task-config.json');
        assert.equal(layout.taskLogPath, '/tmp/demo clip.subtitle/task-log.txt');
        assert.equal(layout.rawCachePath, '/tmp/demo clip.subtitle/cache/raw/whisper-large-v3.ja.srt');
    });
});
