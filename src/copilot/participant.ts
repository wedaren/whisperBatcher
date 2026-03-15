import * as vscode from 'vscode';
import type { SubtitleFlowApi } from '../publicApi';
import { createTaskAgentHandler } from '../agents/task-agent';
import { SUBTITLE_FLOW_PARTICIPANT_FOLLOWUPS, SUBTITLE_FLOW_PARTICIPANT_MANIFEST } from '../subtitleFlowRegistry';

export function createSubtitleFlowParticipantHandler(api: SubtitleFlowApi): vscode.ChatRequestHandler {
    return createTaskAgentHandler(api);
}

/**
 * 注册 `@subtitleFlow` 聊天 participant。
 * 它只负责把自然语言转换成任务控制动作，不直接承载长时间运行的 Whisper 阻塞过程。
 */
export function registerSubtitleFlowParticipant(
    context: vscode.ExtensionContext,
    api: SubtitleFlowApi
): void {
    const participant = vscode.chat.createChatParticipant(
        SUBTITLE_FLOW_PARTICIPANT_MANIFEST.id,
        createSubtitleFlowParticipantHandler(api)
    );

    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg');
    participant.followupProvider = {
        provideFollowups: () => SUBTITLE_FLOW_PARTICIPANT_FOLLOWUPS,
    };

    context.subscriptions.push(participant);
}
