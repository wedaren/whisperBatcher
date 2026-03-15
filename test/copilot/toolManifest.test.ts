import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUBTITLE_FLOW_TOOL_MANIFESTS } from '../../src/subtitleFlowRegistry';
import { SUBTITLE_FLOW_CHAT_PARTICIPANT_ID } from '../../src/copilot/toolNames';

interface PackageToolContribution {
    name: string;
    displayName: string;
    modelDescription: string;
    inputSchema: Record<string, unknown>;
    tags: string[];
}

function loadPackageJson(): any {
    const filePath = path.join(process.cwd(), 'package.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('task-agent tool manifest sync', () => {
    it('should keep toolNames aligned with package.json languageModelTools', () => {
        const packageJson = loadPackageJson();
        const packageTools = packageJson.contributes.languageModelTools as PackageToolContribution[];

        assert.equal(packageTools.length, SUBTITLE_FLOW_TOOL_MANIFESTS.length);

        for (const tool of SUBTITLE_FLOW_TOOL_MANIFESTS) {
            const contribution = packageTools.find((item) => item.name === tool.name);
            assert.ok(contribution, `Missing package.json contribution for ${tool.name}`);
            assert.equal(contribution.displayName, tool.displayName);
            assert.equal(contribution.modelDescription, tool.modelDescription);
            assert.deepEqual(contribution.inputSchema, tool.inputSchema);
            assert.deepEqual(contribution.tags, tool.tags);
        }
    });

    it('should keep activation events aligned with language model tools and participant id', () => {
        const packageJson = loadPackageJson();
        const activationEvents = packageJson.activationEvents as string[];

        assert.ok(
            activationEvents.includes(`onChatParticipant:${SUBTITLE_FLOW_CHAT_PARTICIPANT_ID}`),
            'Missing chat participant activation event'
        );

        for (const tool of SUBTITLE_FLOW_TOOL_MANIFESTS) {
            assert.ok(
                activationEvents.includes(`onLanguageModelTool:${tool.name}`),
                `Missing activation event for ${tool.name}`
            );
        }
    });
});
