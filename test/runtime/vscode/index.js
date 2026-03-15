'use strict';

// Test-only CommonJS shim so compiled unit tests can resolve `require('vscode')`.

class Disposable {
    constructor(fn) {
        this._fn = fn || (() => {});
    }

    dispose() {
        this._fn();
    }
}

class EventEmitter {
    constructor() {
        this.listeners = [];
        this.event = (listener) => {
            this.listeners.push(listener);
            return new Disposable(() => {
                this.listeners = this.listeners.filter((item) => item !== listener);
            });
        };
    }

    fire(value) {
        for (const listener of this.listeners) {
            listener(value);
        }
    }

    dispose() {
        this.listeners = [];
    }
}

class LanguageModelTextPart {
    constructor(value) {
        this.value = value;
    }
}

class LanguageModelToolResult {
    constructor(content) {
        this.content = content;
    }
}

class TreeItem {
    constructor(label, collapsibleState = 0) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

class ThemeIcon {
    constructor(id, color) {
        this.id = id;
        this.color = color;
    }
}

class ThemeColor {
    constructor(id) {
        this.id = id;
    }
}

class MarkdownString {
    constructor(value = '') {
        this.value = value;
    }
}

const registeredTools = new Map();
const registeredCommands = new Map();
const createdParticipants = [];
const treeViews = [];
const executedCommands = [];
const toolInvocations = [];
const infoMessages = [];
const errorMessages = [];
const warningMessages = [];

const configuration = {
    subtitleFlow: {
        maxConcurrency: 2,
        targetLanguages: ['zh-CN'],
        whisperModel: 'tiny',
        whisperBinary: 'whisper',
        whisperModelPath: '',
        whisperLanguage: 'ja',
        complianceRulesPath: '',
        autoRun: true,
        outputFolderSuffix: '.subtitle',
    },
};

const workspace = {
    getConfiguration(section) {
        const values = configuration[section] || {};
        return {
            get(key, defaultValue) {
                return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue;
            },
        };
    },
    fs: {
        async createDirectory() {},
    },
};

const window = {
    async showOpenDialog() {
        return [];
    },
    async showInformationMessage(message) {
        infoMessages.push(message);
        return undefined;
    },
    async showErrorMessage(message) {
        errorMessages.push(message);
        return undefined;
    },
    async showWarningMessage(message) {
        warningMessages.push(message);
        return undefined;
    },
    createTreeView(id, options) {
        const treeView = { id, options, dispose() {} };
        treeViews.push(treeView);
        return treeView;
    },
    createOutputChannel() {
        return {
            appendLine() {},
            show() {},
            dispose() {},
        };
    },
};

const commands = {
    registerCommand(name, handler) {
        registeredCommands.set(name, handler);
        return new Disposable(() => {
            registeredCommands.delete(name);
        });
    },
    async executeCommand(name, ...args) {
        executedCommands.push({ name, args });
        const handler = registeredCommands.get(name);
        return handler ? handler(...args) : undefined;
    },
};

const lm = {
    registerTool(name, tool) {
        registeredTools.set(name, tool);
        return new Disposable(() => {
            registeredTools.delete(name);
        });
    },
    async invokeTool(name, options) {
        toolInvocations.push({ name, options });
        const tool = registeredTools.get(name);
        if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
        }
        return tool.invoke(options, CancellationToken.None);
    },
};

const chat = {
    createChatParticipant(id, handler) {
        const participant = {
            id,
            iconPath: undefined,
            followupProvider: undefined,
            requestHandler: handler,
            dispose() {},
        };
        createdParticipants.push(participant);
        return participant;
    },
};

const Uri = {
    file(fsPath) {
        return { fsPath, scheme: 'file' };
    },
    parse(value) {
        return { fsPath: value, scheme: 'file' };
    },
    joinPath(base, ...parts) {
        const prefix = base && base.fsPath ? base.fsPath : '';
        return { fsPath: [prefix, ...parts].filter(Boolean).join('/'), scheme: 'file' };
    },
};

const env = {
    async openExternal() {
        return false;
    },
};

const CancellationToken = {
    None: { isCancellationRequested: false },
};

const TreeItemCollapsibleState = {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
};

const __testing = {
    registeredTools,
    registeredCommands,
    createdParticipants,
    treeViews,
    executedCommands,
    toolInvocations,
    infoMessages,
    errorMessages,
    warningMessages,
    configuration,
    reset() {
        registeredTools.clear();
        registeredCommands.clear();
        createdParticipants.length = 0;
        treeViews.length = 0;
        executedCommands.length = 0;
        toolInvocations.length = 0;
        infoMessages.length = 0;
        errorMessages.length = 0;
        warningMessages.length = 0;
    },
};

module.exports = {
    CancellationToken,
    Disposable,
    EventEmitter,
    LanguageModelTextPart,
    LanguageModelToolResult,
    MarkdownString,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCollapsibleState,
    Uri,
    chat,
    commands,
    env,
    lm,
    window,
    workspace,
    __testing,
};
