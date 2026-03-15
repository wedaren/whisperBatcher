import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SUBTITLE_FLOW_AGENT_MANIFESTS,
    SUBTITLE_FLOW_CAPABILITY_NAMES,
    SUBTITLE_FLOW_PARTICIPANT_MANIFEST,
    SUBTITLE_FLOW_TOOL_MANIFESTS,
    SUBTITLE_FLOW_TOOL_NAMES,
    listSubtitleFlowCapabilities,
} from '../../src/subtitleFlowRegistry';

describe('subtitleFlowRegistry', () => {
    it('should expose agent manifests through a single registry entry', () => {
        assert.equal(SUBTITLE_FLOW_AGENT_MANIFESTS.length >= 3, true);
        assert.equal(SUBTITLE_FLOW_AGENT_MANIFESTS.some((item) => item.name === 'task-agent'), true);
    });

    it('should expose participant and tool names through the global registry', () => {
        assert.equal(SUBTITLE_FLOW_PARTICIPANT_MANIFEST.id, 'wedaren.whisper-subtitle-flow.agent');
        assert.equal(SUBTITLE_FLOW_TOOL_NAMES.enqueueTask, 'subtitleflow_enqueue_task');
        assert.equal(SUBTITLE_FLOW_TOOL_MANIFESTS.some((item) => item.name === 'subtitleflow_scan_directory'), true);
    });

    it('should expose capability names and built capabilities from the global registry', () => {
        const capabilities = listSubtitleFlowCapabilities();
        assert.equal(SUBTITLE_FLOW_CAPABILITY_NAMES.enqueueTask, 'task.enqueue');
        assert.equal(capabilities.some((item) => item.name === 'task.enqueue-directory'), true);
    });
});
