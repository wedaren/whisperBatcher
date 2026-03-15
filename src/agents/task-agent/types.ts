import type { BatchSummary, TaskResultSummary, TaskSummary } from '../../publicApi';

export type TaskAgentIntent =
    | { type: 'help' }
    | { type: 'list' }
    | { type: 'listBatches' }
    | { type: 'latestBatch' }
    | { type: 'get'; taskId: string }
    | { type: 'result'; taskId: string }
    | { type: 'pause'; taskId: string }
    | { type: 'resume'; taskId: string }
    | { type: 'retry'; taskId: string }
    | { type: 'delete'; taskId: string }
    | { type: 'enqueue'; videoPath: string; autoStart: boolean }
    | { type: 'enqueueDirectory'; directoryPath: string; autoStart: boolean; recursive: boolean }
    | { type: 'runPending' };

export interface TaskAgentPlannerState {
    scanDirectory?: {
        directoryPath: string;
        videos: string[];
        truncated: boolean;
        warnings?: string[];
        suggestedDirectoryPath?: string;
    };
    enqueueTasks?: TaskSummary[];
    latestBatch?: BatchSummary | null;
    taskResult?: TaskResultSummary | null;
}

export interface TaskAgentStep {
    toolName: string;
    input?: Record<string, unknown>;
    buildInput?: (state: TaskAgentPlannerState) => Record<string, unknown>;
    summary: string;
    storeResultAs?: keyof TaskAgentPlannerState;
}

export interface TaskAgentWorkflow {
    steps: TaskAgentStep[];
    inspectTaskAfterStep?: number;
    listTasksAfterExecution?: boolean | ((state: TaskAgentPlannerState) => boolean);
    finalMessage?: string | ((state: TaskAgentPlannerState) => string | undefined);
}

export interface TaskAgentSnapshot {
    tasks: TaskSummary[];
}

export interface TaskAgentChatCommand {
    name: string;
    description: string;
}

export interface TaskAgentFollowup {
    prompt: string;
    label: string;
}

export interface TaskAgentParticipantManifest {
    id: string;
    name: string;
    fullName: string;
    description: string;
    isSticky: boolean;
    commands: TaskAgentChatCommand[];
}
