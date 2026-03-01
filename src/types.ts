/**
 * Core type definitions for Whisper Subtitle Flow
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
    /** Absolute path to *.raw.srt */
    raw?: string;
    /** Absolute path to *.llm.srt */
    llm?: string;
    /** Absolute path to the task log file */
    log?: string;
    /** Absolute path to the task config file */
    config?: string;
    /** Absolute path to the combined Markdown task file (frontmatter + logs) */
    taskFile?: string;
    /** Absolute path to task output folder (e.g. <basename>.subtitle) */
    folder?: string;
    /** Absolute path to the final SRT meant for users (e.g. <basename>.<lang>.srt) */
    finalSrt?: string;
    /** lang code → absolute path to *.<lang>.srt */
    translated: Record<string, string>;
}

export interface TaskConfig {
    whisperModel?: string;
    whisperLanguage?: string;
    targetLanguages?: string[];
}

export interface TaskRecord {
    id: string;
    videoPath: string;
    status: TaskPhase;
    currentPhase: string;
    updatedAt: string;
    outputs: TaskOutputs;
    config?: TaskConfig;
    lastError?: string;
    complianceHits?: number;
}

export interface SrtEntry {
    index: number;
    startTime: string;
    endTime: string;
    text: string;
}

export interface ComplianceRule {
    pattern: string;
    replacement: string;
}

export interface ComplianceLexicon {
    lexicon: Record<string, Record<string, string>>;
}

export interface RestoreMap {
    placeholder: string;
    original: string;
}
