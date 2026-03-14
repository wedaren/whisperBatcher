/**
 * 全局常量定义。
 * 用于集中管理块大小、重试参数、语言映射等魔法数字。
 */

/** LLM 优化阶段每块默认处理的字幕条目数。 */
export const OPTIMIZE_CHUNK_SIZE = 50;

/** 优化阶段相邻块之间的重叠条目数。 */
export const OPTIMIZE_OVERLAP = 5;

/** LLM 翻译阶段每块默认处理的字幕条目数。 */
export const TRANSLATE_CHUNK_SIZE = 20;

/** 翻译阶段相邻块之间的重叠条目数。 */
export const TRANSLATE_OVERLAP = 0;

/** 任务输出目录后缀。 */
export const OUTPUT_FOLDER_SUFFIX = '.subtitle';

/** VS Code LM API 选择模型时使用的 family。 */
export const LLM_MODEL_FAMILY = 'gpt-4o';

/** 相似度阈值：结果与输入过于接近时视为疑似未翻译。 */
export const SIMILARITY_THRESHOLD = 0.9;

/** 未翻译行占比超过该阈值时触发回退。 */
export const UNTRANSLATED_LINE_RATIO = 0.8;

/** 英文字母占比超过该阈值时，用于跳过部分英文目标语言检查。 */
export const ENGLISH_DETECTION_RATIO = 0.7;

/** Whisper 错误信息中保留的 stderr 最大字符数。 */
export const WHISPER_STDERR_LIMIT = 2000;

/** Whisper 错误信息中保留的 stdout 最大字符数。 */
export const WHISPER_STDOUT_LIMIT = 1000;

/** LLM 瞬态错误最大重试次数。 */
export const LLM_MAX_RETRIES = 3;

/** LLM 指数退避的基础延迟（毫秒）。 */
export const LLM_RETRY_BASE_DELAY_MS = 1000;

/** 语言代码到可读语言名的映射，供 prompt 使用。 */
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

/** 文件选择器允许的视频扩展名。 */
export const VIDEO_EXTENSIONS = [
    'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm',
    'm4v', 'mpg', 'mpeg', '3gp', 'ts',
];
