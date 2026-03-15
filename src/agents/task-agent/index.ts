import type * as vscode from 'vscode';
import type { SubtitleFlowApi } from '../../publicApi';
import type { AgentRuntime } from '../runtime';
import { createAgentRuntime } from '../runtime';
import { renderTaskAgentHelp } from './help';
import { snapshotTaskAgentTasks } from './policy';
import { listTaskAgentPlannerTools, planTaskAgentWorkflow } from './planner';
export * from './manifest';
export * from './chatManifest';
export * from './help';
export * from './planner';
export * from './parser';
export * from './registry';

function tryParseToolPayload(content: string): Record<string, unknown> | undefined {
    try {
        return JSON.parse(content) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

function extractTaskId(payload: Record<string, unknown> | undefined): string | undefined {
    return typeof payload?.id === 'string'
        ? payload.id
        : typeof payload?.taskId === 'string'
            ? payload.taskId
            : undefined;
}

async function inspectTask(runtime: AgentRuntime, taskId: string): Promise<void> {
    await runtime.invokeTool('subtitleflow_get_task', { taskId }, `正在读取任务 ${taskId} 的当前状态`);
}

export function createTaskAgentHandler(api: SubtitleFlowApi): vscode.ChatRequestHandler {
    return async (request, chatContext, stream, token) => {
        void chatContext;
        const runtime = createAgentRuntime(api, request, stream, token);
        const tasks = snapshotTaskAgentTasks(api);
        const plan = planTaskAgentWorkflow(
            request.prompt,
            request.command,
            tasks,
            { availableTools: listTaskAgentPlannerTools() }
        );
        const workflow = plan.workflow;

        if (!workflow) {
            stream.markdown(renderTaskAgentHelp());
            return { metadata: { taskCount: api.listTasks().length } };
        }

        let lastKnownTaskId: string | undefined;
        const plannerState: Record<string, unknown> = {};
        for (let index = 0; index < workflow.steps.length; index++) {
            const step = workflow.steps[index];
            const input = step.buildInput ? step.buildInput(plannerState as any) : (step.input ?? {});
            const content = await runtime.invokeTool(step.toolName, input, step.summary);
            const payload = tryParseToolPayload(content);
            if (step.storeResultAs) {
                plannerState[step.storeResultAs] = payload;
            }
            const extractedTaskId = extractTaskId(payload);
            if (extractedTaskId) {
                lastKnownTaskId = extractedTaskId;
            }
            if (workflow.inspectTaskAfterStep === index && lastKnownTaskId) {
                await inspectTask(runtime, lastKnownTaskId);
            }
        }

        const shouldListTasks = typeof workflow.listTasksAfterExecution === 'function'
            ? workflow.listTasksAfterExecution(plannerState as any)
            : workflow.listTasksAfterExecution;
        if (shouldListTasks) {
            await runtime.invokeTool('subtitleflow_list_tasks', {}, '正在刷新字幕任务列表');
        }
        const finalMessage = typeof workflow.finalMessage === 'function'
            ? workflow.finalMessage(plannerState as any)
            : workflow.finalMessage;
        if (finalMessage) {
            stream.markdown(finalMessage);
        }

        return { metadata: { taskCount: api.listTasks().length } };
    };
}
