/**
 * Compliance Service: YAML-based lexicon sanitization & restoration.
 */
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ComplianceLexicon, ComplianceRule, RestoreMap } from '../types';

export class ComplianceService {
    private rules: ComplianceRule[] = [];
    private loaded = false;

    /**
     * Load rules from YAML file path. If path is empty or doesn't exist,
     * runs in passthrough mode.
     */
    loadRules(rulesPath: string): void {
        this.rules = [];
        this.loaded = false;

        if (!rulesPath || !fs.existsSync(rulesPath)) {
            return;
        }

        try {
            const content = fs.readFileSync(rulesPath, 'utf-8');
            const parsed = yaml.load(content) as ComplianceLexicon;

            if (parsed && typeof parsed.lexicon === 'object') {
                const newRules: ComplianceRule[] = [];
                for (const [pattern, translations] of Object.entries(parsed.lexicon)) {
                    // Use a safe fallback like the first configured translation, or just asterisks
                    let safeReplacement = '***';
                    if (translations) {
                        const vals = Object.values(translations);
                        if (vals.length > 0) {
                            safeReplacement = vals[0];
                        }
                    }
                    newRules.push({ pattern, replacement: safeReplacement });
                }

                if (newRules.length > 0) {
                    this.rules = newRules;
                    this.loaded = true;
                }
            }
        } catch {
            // Invalid YAML — passthrough mode
        }
    }

    get isLoaded(): boolean {
        return this.loaded;
    }

    get ruleCount(): number {
        return this.rules.length;
    }

    /**
     * Replace sensitive terms with unique placeholders.
     * Returns sanitized text and a restore map.
     */
    sanitize(text: string): { sanitized: string; restoreMap: RestoreMap[]; hits: number } {
        if (!this.loaded || this.rules.length === 0) {
            return { sanitized: text, restoreMap: [], hits: 0 };
        }

        let sanitized = text;
        const restoreMap: RestoreMap[] = [];
        let hits = 0;
        let placeholderIndex = 0;

        for (const rule of this.rules) {
            const regex = this.buildRuleRegex(rule.pattern);
            let match: RegExpExecArray | null;

            while ((match = regex.exec(sanitized)) !== null) {
                const placeholder = `__COMPLIANCE_${placeholderIndex++}__`;
                restoreMap.push({
                    placeholder,
                    original: rule.replacement || match[0],
                });
                sanitized =
                    sanitized.substring(0, match.index) +
                    placeholder +
                    sanitized.substring(match.index + match[0].length);
                hits++;
                // Reset regex lastIndex because string length changed
                regex.lastIndex = match.index + placeholder.length;
            }
        }

        return { sanitized, restoreMap, hits };
    }

    /**
     * Restore placeholders back to their final replacement text.
     */
    restore(text: string, restoreMap: RestoreMap[]): string {
        let result = text;
        for (const entry of restoreMap) {
            result = result.replaceAll(entry.placeholder, entry.original);
        }
        return result;
    }

    /**
     * Check for residual placeholders that were not properly restored.
     */
    detectLeakage(text: string): boolean {
        return /__COMPLIANCE_\d+__/.test(text);
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private buildRuleRegex(pattern: string): RegExp {
        const escaped = this.escapeRegex(pattern);
        if (this.shouldUseWordBoundary(pattern)) {
            return new RegExp(`\\b${escaped}\\b`, 'gi');
        }
        return new RegExp(escaped, 'gi');
    }

    private shouldUseWordBoundary(pattern: string): boolean {
        return /^[A-Za-z0-9_]+$/.test(pattern);
    }
}
