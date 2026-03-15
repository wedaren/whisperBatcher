#!/usr/bin/env node
/**
 * 根据 Subtitle Flow 全局 registry 同步 package.json 中的受管清单字段。
 * 当前受管字段包括：
 * 1. activationEvents 中与 chat participant / language model tools 相关的条目
 * 2. contributes.chatParticipants
 * 3. contributes.languageModelTools
 *
 * 这样 package.json 的 Copilot 贡献点不再靠手工维护，而是由代码侧 registry 驱动。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const workspaceRoot = process.cwd();
const packageJsonPath = path.join(workspaceRoot, 'package.json');
const registryEntry = path.join(workspaceRoot, 'src', 'subtitleFlowRegistry.ts');

async function loadRegistry() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-flow-registry-'));
    const outfile = path.join(tmpDir, 'registry.cjs');

    try {
        await esbuild.build({
            entryPoints: [registryEntry],
            bundle: true,
            platform: 'node',
            format: 'cjs',
            external: ['vscode'],
            outfile,
            write: true,
            logLevel: 'silent',
        });
        return require(outfile);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function buildActivationEvents(registry, currentActivationEvents) {
    const preservedEvents = currentActivationEvents.filter((item) =>
        !item.startsWith('onChatParticipant:') && !item.startsWith('onLanguageModelTool:')
    );
    return [
        ...preservedEvents,
        `onChatParticipant:${registry.SUBTITLE_FLOW_PARTICIPANT_ID}`,
        ...registry.SUBTITLE_FLOW_TOOL_MANIFESTS.map((tool) => `onLanguageModelTool:${tool.name}`),
    ];
}

function buildChatParticipants(registry) {
    return [registry.SUBTITLE_FLOW_PARTICIPANT_MANIFEST];
}

function buildLanguageModelTools(registry) {
    return registry.SUBTITLE_FLOW_TOOL_MANIFESTS.map((tool) => ({
        name: tool.name,
        displayName: tool.displayName,
        modelDescription: tool.modelDescription,
        inputSchema: tool.inputSchema,
        tags: tool.tags,
    }));
}

async function main() {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const registry = await loadRegistry();

    packageJson.activationEvents = buildActivationEvents(registry, packageJson.activationEvents || []);
    packageJson.contributes = packageJson.contributes || {};
    packageJson.contributes.chatParticipants = buildChatParticipants(registry);
    packageJson.contributes.languageModelTools = buildLanguageModelTools(registry);

    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf-8');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
