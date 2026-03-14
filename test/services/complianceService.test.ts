/**
 * ComplianceService 单元测试。
 * 重点验证词表加载、敏感词替换、恢复和占位符泄露检测。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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

    function writeRules(rules: any[]): string {
        // 测试里动态生成最小 YAML 词表，避免依赖外部资源文件。
        const rulesPath = path.join(tmpDir, 'rules.yaml');
        const escapeValue = (value: string) => value.replace(/"/g, '\\"');
        const yaml = `lexicon:\n${rules.map((r) =>
            `  ${r.pattern}:\n    en: "${escapeValue(r.replacement)}"\n    zh: "${escapeValue(r.replacement)}"\n    ja: "${escapeValue(r.replacement)}"`
        ).join('\n')}`;
        fs.writeFileSync(rulesPath, yaml, 'utf-8');
        return rulesPath;
    }

    describe('loadRules', () => {
        it('应该能加载合法的 YAML 规则', () => {
            const rulesPath = writeRules([
                { pattern: 'badword', replacement: '***' },
                { pattern: 'sensitive', replacement: '[REDACTED]' },
            ]);
            service.loadRules(rulesPath);
            expect(service.isLoaded).toBe(true);
            expect(service.ruleCount).toBe(2);
        });

        it('当路径为空时应该进入直通模式', () => {
            service.loadRules('');
            expect(service.isLoaded).toBe(false);
        });

        it('当文件不存在时应该进入直通模式', () => {
            service.loadRules('/nonexistent/rules.yaml');
            expect(service.isLoaded).toBe(false);
        });
    });

    describe('sanitize', () => {
        it('应该把命中的敏感词替换为占位符', () => {
            const rulesPath = writeRules([
                { pattern: 'badword', replacement: 'goodword' },
            ]);
            service.loadRules(rulesPath);

            const result = service.sanitize('This has a badword in it');
            expect(result.sanitized).not.toContain('badword');
            expect(result.sanitized).toContain('__COMPLIANCE_');
            expect(result.hits).toBe(1);
            expect(result.restoreMap).toHaveLength(1);
        });

        it('应该能处理多次命中', () => {
            const rulesPath = writeRules([
                { pattern: 'bad', replacement: 'good' },
            ]);
            service.loadRules(rulesPath);

            const result = service.sanitize('bad and bad again');
            expect(result.hits).toBe(2);
            expect(result.restoreMap).toHaveLength(2);
        });

        it('没有规则时应该直接透传原文', () => {
            service.loadRules('');
            const result = service.sanitize('anything here');
            expect(result.sanitized).toBe('anything here');
            expect(result.hits).toBe(0);
        });

        it('应该按英文单词边界匹配，避免子串误伤', () => {
            const rulesPath = writeRules([
                { pattern: 'ass', replacement: 'butt' },
            ]);
            service.loadRules(rulesPath);

            const result = service.sanitize('class ass classy ASS');
            expect(result.hits).toBe(2);
            expect(result.sanitized.toLowerCase()).toContain('class');
            expect(result.sanitized.toLowerCase()).toContain('classy');
            expect(result.sanitized).not.toContain(' ass ');
            expect(result.sanitized).not.toContain(' ASS');
        });
    });

    describe('restore', () => {
        it('应该能把占位符恢复为替换文本', () => {
            const rulesPath = writeRules([
                { pattern: 'badword', replacement: 'goodword' },
            ]);
            service.loadRules(rulesPath);

            const { sanitized, restoreMap } = service.sanitize('Hello badword world');
            const restored = service.restore(sanitized, restoreMap);
            expect(restored).toBe('Hello goodword world');
            expect(restored).not.toContain('__COMPLIANCE_');
        });
    });

    describe('detectLeakage', () => {
        it('应该能检测残留占位符', () => {
            expect(service.detectLeakage('some __COMPLIANCE_0__ text')).toBe(true);
            expect(service.detectLeakage('clean text')).toBe(false);
        });
    });
});
