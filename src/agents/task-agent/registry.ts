/**
 * TaskAgent 统一注册中心。
 * 这里集中暴露 participant 元数据、工具 manifest、followups 和工具名映射，
 * 供 copilot 适配层、agent host 和测试统一消费。
 */
export { TASK_AGENT_PARTICIPANT_ID, TASK_AGENT_PARTICIPANT_MANIFEST, TASK_AGENT_CHAT_COMMANDS, TASK_AGENT_FOLLOWUPS } from './chatManifest';
export { TASK_AGENT_TOOL_MANIFESTS, TASK_AGENT_TOOLS } from './tools';
export { TASK_AGENT_MANIFEST } from './manifest';
