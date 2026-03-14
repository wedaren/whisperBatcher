/**
 * ComplianceService 单元测试。
 * 重点验证词表加载、敏感词替换、恢复和占位符泄露检测。
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ComplianceService } from '../../src/services/complianceService';

describe('ComplianceService', () => {
    let service: ComplianceService;
    let tmpDir: string;

    beforeEach(() => {
        service = new ComplianceService();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compliance-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeRules(rules: Array<{ pattern: string; replacement: string }>): string {
        const rulesPath = path.join(tmpDir, 'rules.yaml');
        const escapeValue = (value: string) => value.replace(/"/g, '\\"');
        const yaml = `lexicon:\n${rules.map((rule) =>
            `  ${rule.pattern}:\n    en: "${escapeValue(rule.replacement)}"\n    zh: "${escapeValue(rule.replacement)}"\n    ja: "${escapeValue(rule.replacement)}"`
        ).join('\n')}`;
        fs.writeFileSync(rulesPath, yaml, 'utf-8');
        return rulesPath;
    }

    it('should load valid YAML rules', () => {
        const rulesPath = writeRules([
            { pattern: 'badword', replacement: '***' },
            { pattern: 'sensitive', replacement: '[REDACTED]' },
        ]);
        service.loadRules(rulesPath);
        assert.equal(service.isLoaded, true);
        assert.equal(service.ruleCount, 2);
    });

    it('should fall back to pass-through mode when rules path is empty', () => {
        service.loadRules('');
        assert.equal(service.isLoaded, false);
    });

    it('should sanitize matched patterns into placeholders', () => {
        const rulesPath = writeRules([{ pattern: 'badword', replacement: 'goodword' }]);
        service.loadRules(rulesPath);

        const result = service.sanitize('This has a badword in it');
        assert.equal(result.sanitized.includes('badword'), false);
        assert.equal(result.sanitized.includes('__COMPLIANCE_'), true);
        assert.equal(result.hits, 1);
        assert.equal(result.restoreMap.length, 1);
    });

    it('should restore placeholders with replacement text', () => {
        const rulesPath = writeRules([{ pattern: 'badword', replacement: 'goodword' }]);
        service.loadRules(rulesPath);

        const { sanitized, restoreMap } = service.sanitize('Hello badword world');
        const restored = service.restore(sanitized, restoreMap);
        assert.equal(restored, 'Hello goodword world');
        assert.equal(restored.includes('__COMPLIANCE_'), false);
    });

    it('should detect placeholder leakage', () => {
        assert.equal(service.detectLeakage('some __COMPLIANCE_0__ text'), true);
        assert.equal(service.detectLeakage('clean text'), false);
    });
});
