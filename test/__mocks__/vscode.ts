/**
 * Jest 测试环境下的最小 VS Code mock。
 * 只实现当前测试用到的接口，避免依赖真实扩展宿主。
 */
export const Uri = {
    file: (path: string) => ({ fsPath: path, scheme: 'file' }),
    parse: (str: string) => ({ fsPath: str, scheme: 'file' }),
};

export class EventEmitter {
    private listeners: Function[] = [];
    event = (listener: Function) => {
        this.listeners.push(listener);
        return { dispose: () => { } };
    };
    fire(data?: any) {
        this.listeners.forEach((l) => l(data));
    }
    dispose() {
        this.listeners = [];
    }
}

export const workspace = {
    getConfiguration: () => ({
        get: (key: string, defaultValue?: any) => defaultValue,
    }),
    fs: {
        createDirectory: async () => { },
    },
};

export const window = {
    showOpenDialog: async () => [],
    showInformationMessage: async () => { },
    showErrorMessage: async () => { },
    createTreeView: () => ({ dispose: () => { } }),
};

export const commands = {
    registerCommand: () => ({ dispose: () => { } }),
    executeCommand: async () => { },
};

export const env = {
    openExternal: async () => false,
};

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export class TreeItem {
    label: string;
    collapsibleState: TreeItemCollapsibleState;
    iconPath: any;
    contextValue?: string;
    command?: any;
    tooltip?: any;
    id?: string;
    resourceUri?: any;

    constructor(label: string, collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

export class ThemeIcon {
    constructor(public readonly id: string, public readonly color?: any) { }
}

export class ThemeColor {
    constructor(public readonly id: string) { }
}

export class MarkdownString {
    value: string;
    constructor(value?: string) {
        this.value = value || '';
    }
}
