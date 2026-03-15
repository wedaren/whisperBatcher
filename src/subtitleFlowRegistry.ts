/**
 * Subtitle Flow 全局 registry。
 * 这是扩展内部关于 agent / participant / tool / capability 的统一读取入口。
 * 目标是让 extension、copilot 适配层、agent host 和测试都从这里拿清单，
 * 避免继续分散引用 task-agent 和 agent-host 的各个细节文件。
 */
import { buildSubtitleFlowCapabilities, SUBTITLE_FLOW_CAPABILITIES } from './agent-host';
import { EXECUTION_AGENT_MANIFEST } from './agents/execution-agent';
import { REVIEW_AGENT_MANIFEST } from './agents/review-agent';
import { TASK_AGENT_MANIFEST } from './agents/task-agent/manifest';
import {
    TASK_AGENT_CHAT_COMMANDS,
    TASK_AGENT_FOLLOWUPS,
    TASK_AGENT_PARTICIPANT_ID,
    TASK_AGENT_PARTICIPANT_MANIFEST,
} from './agents/task-agent/chatManifest';
import { TASK_AGENT_TOOLS, TASK_AGENT_TOOL_MANIFESTS } from './agents/task-agent/tools';

export const SUBTITLE_FLOW_AGENT_MANIFESTS = [
    TASK_AGENT_MANIFEST,
    EXECUTION_AGENT_MANIFEST,
    REVIEW_AGENT_MANIFEST,
];

export const SUBTITLE_FLOW_PARTICIPANT_ID = TASK_AGENT_PARTICIPANT_ID;
export const SUBTITLE_FLOW_PARTICIPANT_MANIFEST = TASK_AGENT_PARTICIPANT_MANIFEST;
export const SUBTITLE_FLOW_PARTICIPANT_COMMANDS = TASK_AGENT_CHAT_COMMANDS;
export const SUBTITLE_FLOW_PARTICIPANT_FOLLOWUPS = TASK_AGENT_FOLLOWUPS;
export const SUBTITLE_FLOW_TOOL_NAMES = TASK_AGENT_TOOLS;
export const SUBTITLE_FLOW_TOOL_MANIFESTS = TASK_AGENT_TOOL_MANIFESTS;
export const SUBTITLE_FLOW_CAPABILITY_NAMES = SUBTITLE_FLOW_CAPABILITIES;

export function listSubtitleFlowCapabilities() {
    return buildSubtitleFlowCapabilities();
}
