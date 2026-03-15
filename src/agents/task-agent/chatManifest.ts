import type { TaskAgentChatCommand, TaskAgentFollowup, TaskAgentParticipantManifest } from './types';

/**
 * TaskAgent 的 participant id。
 * 由 task-agent 自身定义，避免 copilot 适配层与 task-agent registry 形成循环依赖。
 */
export const TASK_AGENT_PARTICIPANT_ID = 'wedaren.whisper-subtitle-flow.agent';

/**
 * TaskAgent 面向 chat participant 的命令清单。
 * package.json 中的 chatParticipants.commands 应与这里保持一致。
 */
export const TASK_AGENT_CHAT_COMMANDS: TaskAgentChatCommand[] = [
    { name: 'help', description: 'Show subtitle agent usage' },
    { name: 'list', description: 'List subtitle tasks' },
    { name: 'enqueue', description: 'Create a queued subtitle task from a video path' },
    { name: 'run', description: 'Start the pending queue or create and start a task' },
    { name: 'get', description: 'Inspect one subtitle task' },
    { name: 'pause', description: 'Pause a running subtitle task' },
    { name: 'resume', description: 'Resume a paused subtitle task' },
    { name: 'retry', description: 'Retry a failed subtitle task' },
    { name: 'delete', description: 'Delete a subtitle task record' },
];

/**
 * participant 默认 followup 建议也统一收口到 task-agent。
 */
export const TASK_AGENT_FOLLOWUPS: TaskAgentFollowup[] = [
    { prompt: '/list', label: '列出任务' },
    { prompt: '/run', label: '启动队列' },
    { prompt: '/enqueue "/absolute/path/video.mp4"', label: '创建任务' },
];

/**
 * TaskAgent 对应的 participant 元信息。
 * package.json 中的 chatParticipants 主体字段应与这里保持一致。
 */
export const TASK_AGENT_PARTICIPANT_MANIFEST: TaskAgentParticipantManifest = {
    id: TASK_AGENT_PARTICIPANT_ID,
    name: 'subtitleFlow',
    fullName: 'Subtitle Flow Agent',
    description: 'Manage subtitle background jobs for long-running Whisper and LLM workflows.',
    isSticky: true,
    commands: TASK_AGENT_CHAT_COMMANDS,
};
