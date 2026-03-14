/**
 * Copilot participant 和工具名集中定义在这里，
 * 避免 package.json、工具注册代码和 participant 调用代码出现漂移。
 */
export const SUBTITLE_FLOW_CHAT_PARTICIPANT_ID = 'wedaren.whisper-subtitle-flow.agent';

export const SUBTITLE_FLOW_TOOL_NAMES = {
    listTasks: 'subtitleflow_list_tasks',
    getTask: 'subtitleflow_get_task',
    enqueueTask: 'subtitleflow_enqueue_task',
    runPending: 'subtitleflow_run_pending',
    pauseTask: 'subtitleflow_pause_task',
    resumeTask: 'subtitleflow_resume_task',
    retryTask: 'subtitleflow_retry_task',
    deleteTask: 'subtitleflow_delete_task',
} as const;

export type SubtitleFlowToolName = typeof SUBTITLE_FLOW_TOOL_NAMES[keyof typeof SUBTITLE_FLOW_TOOL_NAMES];
