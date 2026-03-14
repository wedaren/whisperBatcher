/**
 * 合规服务。
 * 负责加载 YAML 词表，并在 LLM 处理前后执行敏感词替换与恢复。
 */
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { ComplianceLexicon, ComplianceRule, RestoreMap } from '../types';

export class ComplianceService {
    private rules: ComplianceRule[] = [];
    private loaded = false;

    /**
     * 从 YAML 文件加载规则。
     * 路径为空或文件不存在时进入直通模式。
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
                    // 如果配置了多语言替换，当前简单取第一个值作为安全替换结果。
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
            // YAML 解析失败时不阻塞主流程，保持直通模式。
        }
    }

    get isLoaded(): boolean {
        return this.loaded;
    }

    get ruleCount(): number {
        return this.rules.length;
    }

    /**
     * 将敏感词替换成唯一占位符。
     * 返回替换后的文本、恢复映射和命中次数。
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
                // 字符串长度改变后必须重置 lastIndex，否则后续匹配位置会错乱。
                regex.lastIndex = match.index + placeholder.length;
            }
        }

        return { sanitized, restoreMap, hits };
    }

    /**
     * 把占位符恢复成最终替换文本。
     */
    restore(text: string, restoreMap: RestoreMap[]): string {
        let result = text;
        for (const entry of restoreMap) {
            result = result.replaceAll(entry.placeholder, entry.original);
        }
        return result;
    }

    /**
     * 检查最终文本中是否仍残留占位符。
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
