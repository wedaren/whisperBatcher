/**
 * ComplianceService unit tests
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
        const rulesPath = path.join(tmpDir, 'rules.yaml');
        const escapeValue = (value: string) => value.replace(/"/g, '\\"');
        const yaml = `lexicon:\n${rules.map((r) =>
            `  ${r.pattern}:\n    en: "${escapeValue(r.replacement)}"\n    zh: "${escapeValue(r.replacement)}"\n    ja: "${escapeValue(r.replacement)}"`
        ).join('\n')}`;
        fs.writeFileSync(rulesPath, yaml, 'utf-8');
        return rulesPath;
    }

    describe('loadRules', () => {
        it('should load valid YAML rules', () => {
            const rulesPath = writeRules([
                { pattern: 'badword', replacement: '***' },
                { pattern: 'sensitive', replacement: '[REDACTED]' },
            ]);
            service.loadRules(rulesPath);
            expect(service.isLoaded).toBe(true);
            expect(service.ruleCount).toBe(2);
        });

        it('should run in passthrough mode when path is empty', () => {
            service.loadRules('');
            expect(service.isLoaded).toBe(false);
        });

        it('should run in passthrough mode when file does not exist', () => {
            service.loadRules('/nonexistent/rules.yaml');
            expect(service.isLoaded).toBe(false);
        });
    });

    describe('sanitize', () => {
        it('should replace patterns with placeholders', () => {
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

        it('should handle multiple occurrences', () => {
            const rulesPath = writeRules([
                { pattern: 'bad', replacement: 'good' },
            ]);
            service.loadRules(rulesPath);

            const result = service.sanitize('bad and bad again');
            expect(result.hits).toBe(2);
            expect(result.restoreMap).toHaveLength(2);
        });

        it('should passthrough when no rules loaded', () => {
            service.loadRules('');
            const result = service.sanitize('anything here');
            expect(result.sanitized).toBe('anything here');
            expect(result.hits).toBe(0);
        });

        it('should match english words by boundary and avoid substring false positives', () => {
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
        it('should restore placeholders to replacement text', () => {
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
        it('should detect residual compliance placeholders', () => {
            expect(service.detectLeakage('some __COMPLIANCE_0__ text')).toBe(true);
            expect(service.detectLeakage('clean text')).toBe(false);
        });
    });
});
