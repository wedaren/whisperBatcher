import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUBTITLE_FLOW_PARTICIPANT_FOLLOWUPS, SUBTITLE_FLOW_PARTICIPANT_MANIFEST } from '../../src/subtitleFlowRegistry';
import { createSubtitleFlowParticipantHandler, registerSubtitleFlowParticipant } from '../../src/copilot/participant';
import * as vscode from 'vscode';

function loadPackageJson(): any {
    const filePath = path.join(process.cwd(), 'package.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('task-agent participant manifest sync', () => {
    it('should keep chat participant commands aligned with package.json', () => {
        const packageJson = loadPackageJson();
        const participant = packageJson.contributes.chatParticipants.find(
            (item: { id: string }) => item.id === SUBTITLE_FLOW_PARTICIPANT_MANIFEST.id
        );

        assert.ok(participant, 'Missing subtitleFlow chat participant contribution');
        assert.deepEqual(participant, SUBTITLE_FLOW_PARTICIPANT_MANIFEST);
    });

    it('should expose followups defined by task-agent manifest', () => {
        const api = {
            listTasks: () => [],
        } as any;
        const handler = createSubtitleFlowParticipantHandler(api);
        assert.equal(typeof handler, 'function');

        const context = {
            extensionUri: vscode.Uri.file(process.cwd()),
            subscriptions: [],
        } as any;
        registerSubtitleFlowParticipant(context, api);

        const participant = (vscode as any).__testing.createdParticipants[0];
        const followups = participant.followupProvider.provideFollowups();
        assert.deepEqual(followups, SUBTITLE_FLOW_PARTICIPANT_FOLLOWUPS);
    });
});
