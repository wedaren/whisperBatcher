import type { AgentManifest } from '../../publicApi';
import { TASK_AGENT_TOOLS } from './tools';

/**
 * TaskAgent 的自描述信息。
 * 它面向 VS Code Chat 和其他上层 agent，负责任务工作流编排。
 */
export const TASK_AGENT_MANIFEST: AgentManifest = {
    name: 'task-agent',
    description: '负责理解任务意图、编排任务工具链并驱动后台字幕任务。',
    responsibilities: [
        '解析用户意图或上层 agent 指令',
        '编排 enqueue、runPending、get、pause、resume、retry、delete 等任务工具',
        '适配 Whisper 长任务的后台执行模型',
    ],
    tools: Object.values(TASK_AGENT_TOOLS),
    capabilityNames: [
        'task.scan-directory',
        'task.enqueue',
        'task.enqueue-batch',
        'task.enqueue-directory',
        'task.run-pending',
        'task.get',
        'task.list',
        'task.pause',
        'task.resume',
        'task.retry',
        'task.delete',
        'task.run-pipeline',
    ],
    inputSchemaSummary: '自然语言提示或结构化任务控制输入，例如 videoPath、taskId。',
    outputSchemaSummary: 'TaskSummary、TaskSummary[] 或任务控制确认结果。',
};
