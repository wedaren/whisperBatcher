/**
 * 双语 ASS 生成测试。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AssSubtitleService } from '../../src/services/assSubtitleService';

describe('AssSubtitleService', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ass-subtitle-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should build one bilingual ass file from source and translated srt', async () => {
        const sourcePath = path.join(tmpDir, 'source.srt');
        const translatedPath = path.join(tmpDir, 'translated.srt');
        const outputPath = path.join(tmpDir, 'bilingual.ass');
        fs.writeFileSync(sourcePath, '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n');
        fs.writeFileSync(translatedPath, '1\n00:00:01,000 --> 00:00:02,000\n你好\n');

        const service = new AssSubtitleService();
        await service.createBilingualAss(sourcePath, translatedPath, 'zh-CN', outputPath);

        const content = fs.readFileSync(outputPath, 'utf-8');
        assert.equal(content.includes('[Events]'), true);
        assert.equal(content.includes('Dialogue: 0,0:00:01.00,0:00:02.00,Source'), true);
        assert.equal(content.includes('こんにちは'), true);
        assert.equal(content.includes('你好'), true);
    });
});
