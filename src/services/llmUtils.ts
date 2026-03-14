/**
 * LLM 处理公共工具。
 * 由优化和翻译两个服务共享，避免重复实现解析和调试逻辑。
 */
import * as fs from 'fs';
import * as path from 'path';
import { RestoreMap } from '../types';

/**
 * 解析带编号的 LLM 响应，例如 `[1] 文本`。
 * 如果没有编号但总行数匹配期望值，则退化为逐行原样返回。
 */
export function parseNumberedResponse(text: string, expectedCount: number): string[] {
    const lines = text.trim().split('\n').filter((l) => l.trim());
    const result: string[] = [];

    for (const line of lines) {
        const match = line.match(/^\[(\d+)\]\s*(.*)/);
        if (match) {
            result.push(match[2].trim());
        }
    }

    if (result.length === 0 && lines.length === expectedCount) {
        return lines.map((l) => l.trim());
    }

    return result;
}

/**
 * 判断模型返回是否更像安全拒答，而不是正常业务内容。
 */
export function isRefusal(text: string): boolean {
    const lower = text.toLowerCase();
    return (
        lower.includes("sorry, i can't") ||
        lower.includes("sorry, i cannot") ||
        lower.includes("as an ai language model") ||
        lower.includes("i'm unable to") ||
        lower.includes("i am unable to") ||
        lower.includes("does not comply") ||
        lower.includes("violates") ||
        lower.includes("safety policy")
    );
}

/**
 * 将调试信息写入 `llm-debug` 目录。
 * 包括 JSON 上下文以及可选的 prompt / response 文本。
 */
export function writeDebugDump(outDir: string, prefix: string, data: Record<string, unknown>): void {
    try {
        const debugDir = path.join(outDir, '.subtitle', 'llm-debug');
        if (!fs.existsSync(debugDir)) { fs.mkdirSync(debugDir, { recursive: true }); }
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const base = path.join(debugDir, `${prefix}_${ts}`);
        fs.writeFileSync(`${base}.json`, JSON.stringify(data, null, 2), 'utf-8');
        if (data.numberedPrompt) {
            fs.writeFileSync(`${base}.prompt.txt`, data.numberedPrompt as string, 'utf-8');
        }
        if (data.rawResponse) {
            fs.writeFileSync(`${base}.response.txt`, data.rawResponse as string, 'utf-8');
        }
    } catch (e) {
        console.error('写入 llm 调试转储失败', e);
    }
}

/**
 * 将文本数组转换成带编号的 prompt。
 */
export function buildNumberedPrompt(texts: string[]): string {
    return texts.map((t, idx) => `[${idx + 1}] ${t}`).join('\n');
}

/** 单行 sanitize 的恢复映射结构。 */
export interface SanitizeEntry {
    idx: number;
    map: RestoreMap[];
}
