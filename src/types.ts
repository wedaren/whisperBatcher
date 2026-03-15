/**
 * 核心类型定义。
 * 被任务存储、调度器、视图层和服务层共同使用。
 */

export type TaskPhase =
    | 'queued'
    | 'transcribing'
    | 'optimizing'
    | 'translating'
    | 'completed'
    | 'failed'
    | 'paused';

export interface TaskOutputs {
    /** `*.raw.srt` 的绝对路径。 */
    raw?: string;
    /** `*.llm.srt` 的绝对路径。 */
    llm?: string;
    /** 任务日志文件的绝对路径。 */
    log?: string;
    /** 任务配置文件的绝对路径。 */
    config?: string;
    /** 任务输出目录绝对路径，例如 `<basename>.subtitle`。 */
    folder?: string;
    /** 面向用户的最终字幕文件绝对路径。 */
    finalSrt?: string;
    /** 语言代码到翻译结果文件路径的映射。 */
    translated: Record<string, string>;
}

/** 任务级配置覆写项。 */
export interface TaskConfig {
    whisperModel?: string;
    whisperLanguage?: string;
    targetLanguages?: string[];
}

/** 持久化在 `tasks.json` 中的任务记录。 */
export interface TaskRecord {
    id: string;
    videoPath: string;
    createdAt: string;
    status: TaskPhase;
    currentPhase: string;
    updatedAt: string;
    batchId?: string;
    outputs: TaskOutputs;
    config?: TaskConfig;
    lastError?: string;
    complianceHits?: number;
}

/** 单条字幕条目。 */
export interface SrtEntry {
    index: number;
    startTime: string;
    endTime: string;
    text: string;
}

/** 单条合规替换规则。 */
export interface ComplianceRule {
    pattern: string;
    replacement: string;
}

/** 合规 YAML 的顶层结构。 */
export interface ComplianceLexicon {
    lexicon: Record<string, Record<string, string>>;
}

/** 占位符恢复映射。 */
export interface RestoreMap {
    placeholder: string;
    original: string;
}
