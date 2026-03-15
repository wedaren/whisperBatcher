import { SUBTITLE_FLOW_PARTICIPANT_ID, SUBTITLE_FLOW_TOOL_NAMES as REGISTRY_TOOL_NAMES } from '../subtitleFlowRegistry';

/**
 * Copilot participant 和工具名集中定义在这里。
 * 工具名本身来自 task-agent 的统一 manifest，避免多处手写漂移。
 */
export const SUBTITLE_FLOW_CHAT_PARTICIPANT_ID = SUBTITLE_FLOW_PARTICIPANT_ID;

export const SUBTITLE_FLOW_TOOL_NAMES = REGISTRY_TOOL_NAMES;

export type SubtitleFlowToolName = typeof SUBTITLE_FLOW_TOOL_NAMES[keyof typeof SUBTITLE_FLOW_TOOL_NAMES];
