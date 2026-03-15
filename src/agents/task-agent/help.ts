/**
 * TaskAgent 面向用户的简要帮助提示。
 * 这份文案同时服务 participant fallback 输出和开发文档。
 */
export function renderTaskAgentHelp(): string {
    return [
        '`@subtitleFlow` 通过后台任务方式运行字幕流程，适合处理耗时较长的 Whisper 转录。',
        '',
        '推荐命令：',
        '- `/list`',
        '- `/enqueue "/absolute/path/video.mp4"`',
        '- `/run "/absolute/path/video.mp4"`',
        '- `/run` 或 `run pending`',
        '- `/get task_123456_abcdef`',
        '- `/pause task_123456_abcdef`',
        '- `/resume task_123456_abcdef`',
        '- `/retry task_123456_abcdef`',
        '- `/delete task_123456_abcdef`',
        '',
        '说明：',
        '- `/enqueue` 只创建任务，不等待 Whisper 完成',
        '- `/run` 会创建任务并尝试启动后台队列',
        '- 长任务请用 `/get` 或 `/list` 轮询状态',
    ].join('\n');
}
