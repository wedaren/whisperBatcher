import type { SubtitleFlowApi, TaskSummary } from '../../publicApi';
import type { TaskAgentIntent, TaskAgentWorkflow } from './types';
import { buildTaskAgentWorkflow, inferTaskAgentIntent, parseTaskAgentIntent } from './policy';
import { TASK_AGENT_TOOLS } from './tools';

export interface TaskAgentToolContext {
    availableTools: string[];
}

export interface TaskAgentPlan {
    intent: TaskAgentIntent;
    workflow?: TaskAgentWorkflow;
}

/**
 * TaskAgent 的轻量 planner。
 * 它不做开放式推理，而是基于可用工具白名单生成有限步计划。
 */
export function planTaskAgentWorkflow(
    prompt: string,
    command: string | undefined,
    tasks: TaskSummary[],
    toolContext: TaskAgentToolContext = { availableTools: Object.values(TASK_AGENT_TOOLS) }
): TaskAgentPlan {
    const explicitIntent = parseTaskAgentIntent(command, prompt);
    const intent = inferTaskAgentIntent(prompt, tasks, explicitIntent);
    const workflow = buildTaskAgentWorkflow(intent, tasks);

    if (!workflow) {
        return { intent, workflow };
    }

    const filteredSteps = workflow.steps.filter((step) => toolContext.availableTools.includes(step.toolName)).slice(0, 4);
    return {
        intent,
        workflow: {
            ...workflow,
            steps: filteredSteps,
        },
    };
}

/**
 * 供 runtime 或上层 agent 暴露当前 task-agent 可用工具清单。
 */
export function listTaskAgentPlannerTools(): string[] {
    return Object.values(TASK_AGENT_TOOLS);
}
