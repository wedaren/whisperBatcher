/**
 * Centralized constants for Whisper Subtitle Flow.
 * All magic numbers and hardcoded configuration values live here.
 */

/** Number of SRT entries per chunk during LLM optimization */
export const OPTIMIZE_CHUNK_SIZE = 50;

/** Number of overlapping entries between optimization chunks */
export const OPTIMIZE_OVERLAP = 5;

/** Number of SRT entries per chunk during LLM translation */
export const TRANSLATE_CHUNK_SIZE = 20;

/** Number of overlapping entries between translation chunks */
export const TRANSLATE_OVERLAP = 0;

/** Suffix appended to video basename to create the output folder */
export const OUTPUT_FOLDER_SUFFIX = '.subtitle';

/** VS Code LM API model family selector */
export const LLM_MODEL_FAMILY = 'gpt-4o';

/** Similarity threshold: if more than this ratio of lines are similar, translation is suspect */
export const SIMILARITY_THRESHOLD = 0.9;

/** If more than this ratio of lines are untranslated (similar), fall back */
export const UNTRANSLATED_LINE_RATIO = 0.8;

/** If more than this ratio of chars are English-like, skip similarity check or pass through */
export const ENGLISH_DETECTION_RATIO = 0.7;

/** Max chars of stderr to include in whisper error messages */
export const WHISPER_STDERR_LIMIT = 2000;

/** Max chars of stdout to include in whisper error messages */
export const WHISPER_STDOUT_LIMIT = 1000;

/** Maximum number of retries for transient LLM errors */
export const LLM_MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff between LLM retries (1s, 2s, 4s) */
export const LLM_RETRY_BASE_DELAY_MS = 1000;

/** Map of language codes to human-readable names for LLM prompts */
export const LANG_NAMES: Record<string, string> = {
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'it': 'Italian',
    'ar': 'Arabic',
};

/** Supported video file extensions for the file picker */
export const VIDEO_EXTENSIONS = [
    'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm',
    'm4v', 'mpg', 'mpeg', '3gp', 'ts',
];
