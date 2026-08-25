// A controllable stand-in for the `vscode` module.
//
// Vitest aliases `vscode` to this file so that the extension-facing modules can be
// unit tested outside an extension host. Only the surface the extension actually
// uses is implemented; anything else should fail loudly rather than silently
// returning `undefined`.

import { promises as fs } from "node:fs";
import path from "node:path";

export type DisposeCallback = () => void;

export class Disposable {
  public constructor(private readonly callback: DisposeCallback) {}

  public dispose(): void {
    this.callback();
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  public readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };

  public fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}

export class Position {
  public constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  public constructor(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
  ) {}

  public static file(value: string): Uri {
    return new Uri("file", value);
  }

  public static parse(value: string): Uri {
    const separator = value.indexOf(":");
    if (separator < 0) {
      return new Uri("file", value);
    }
    return new Uri(value.slice(0, separator), value.slice(separator + 1));
  }

  public get path(): string {
    return this.fsPath;
  }

  public toString(): string {
    return `${this.scheme}:${this.fsPath}`;
  }
}

export class MarkdownString {
  public value = "";
  public isTrusted = false;
  public supportHtml = false;

  public appendText(value: string): this {
    this.value += value;
    return this;
  }

  public appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }
}

export class ThemeColor {
  public constructor(public readonly id: string) {}
}

export class ThemeIcon {
  public constructor(public readonly id: string) {}
}

export class CodeLens {
  public constructor(
    public readonly range: Range,
    public readonly command?: MockCommand,
  ) {}
}

export class TreeItem {
  public description?: string;
  public tooltip?: string;
  public iconPath?: ThemeIcon;
  public command?: MockCommand;
  public contextValue?: string;
  public id?: string;

  public constructor(
    public readonly label: string,
    public readonly collapsibleState = 0,
  ) {}
}

export interface MockCommand {
  readonly command: string;
  readonly title: string;
  readonly arguments?: readonly unknown[];
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 } as const;
export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
} as const;
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const ViewColumn = { Active: -1, Beside: -2, One: 1 } as const;

export interface MockTextLine {
  readonly text: string;
}

export interface MockTextDocument {
  readonly uri: Uri;
  readonly fileName: string;
  readonly lineCount: number;
  getText: () => string;
  lineAt: (line: number) => MockTextLine;
}

export interface MockDecorationCall {
  readonly decoration: MockDecorationType;
  readonly ranges: readonly { readonly range: Range; readonly hoverMessage?: MarkdownString }[];
}

export interface MockDecorationType {
  readonly id: number;
  readonly options: unknown;
  dispose: () => void;
}

export interface MockTextEditor {
  readonly document: MockTextDocument;
  readonly decorations: MockDecorationCall[];
  revealed: Range | undefined;
  selection: Range | undefined;
  setDecorations: (
    decoration: MockDecorationType,
    ranges: readonly { readonly range: Range; readonly hoverMessage?: MarkdownString }[],
  ) => void;
  revealRange: (range: Range, type: number) => void;
}

export interface MockStatusBarItem {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  visible: boolean;
  show: () => void;
  hide: () => void;
  dispose: () => void;
}

export interface MockLogOutputChannel {
  readonly lines: string[];
  appendLine: (value: string) => void;
  info: (value: string) => void;
  warn: (value: string) => void;
  error: (value: string) => void;
  show: (preserveFocus?: boolean) => void;
  dispose: () => void;
}

export interface MockWorkspaceFolder {
  readonly uri: Uri;
  readonly name: string;
  readonly index: number;
}

interface MockState {
  workspaceFolders: MockWorkspaceFolder[] | undefined;
  configuration: Map<string, unknown>;
  informationResponses: (string | undefined)[];
  warningResponses: (string | undefined)[];
  shownMessages: string[];
  visibleTextEditors: MockTextEditor[];
  registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  executedCommands: { readonly command: string; readonly args: readonly unknown[] }[];
  decorationTypes: MockDecorationType[];
  outputChannels: MockLogOutputChannel[];
  statusBarItems: MockStatusBarItem[];
  codeLensProviders: unknown[];
  contentProviders: Map<string, unknown>;
  quickPickResponses: unknown[];
  quickPickRequests: unknown[][];
  treeDataProviders: Map<string, unknown>;
  webviewProviders: Map<string, unknown>;
  activeTextEditor: MockTextEditor | undefined;
  onDidChangeVisibleEditors: EventEmitter<readonly MockTextEditor[]>;
  decorationCounter: number;
}

export const mockState: MockState = createState();

function createState(): MockState {
  return {
    workspaceFolders: undefined,
    configuration: new Map<string, unknown>(),
    informationResponses: [],
    warningResponses: [],
    shownMessages: [],
    visibleTextEditors: [],
    registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
    executedCommands: [],
    decorationTypes: [],
    outputChannels: [],
    statusBarItems: [],
    codeLensProviders: [],
    contentProviders: new Map<string, unknown>(),
    quickPickResponses: [],
    quickPickRequests: [],
    treeDataProviders: new Map<string, unknown>(),
    webviewProviders: new Map<string, unknown>(),
    activeTextEditor: undefined,
    onDidChangeVisibleEditors: new EventEmitter<readonly MockTextEditor[]>(),
    decorationCounter: 0,
  };
}

/** Restores every mutable part of the fake between tests. */
export function resetVscodeMock(): void {
  const fresh = createState();
  for (const key of Object.keys(fresh) as (keyof MockState)[]) {
    Object.assign(mockState, { [key]: fresh[key] });
  }
}

/** Registers a workspace folder so that `workspace.workspaceFolders` reports it. */
export function setWorkspaceFolders(roots: readonly string[]): void {
  mockState.workspaceFolders = roots.map((root, index) => ({
    uri: Uri.file(root),
    name: path.basename(root),
    index,
  }));
}

/** Sets a configuration value addressed as `section.key`. */
export function setConfiguration(fullKey: string, value: unknown): void {
  mockState.configuration.set(fullKey, value);
}

export const workspace = {
  get workspaceFolders(): readonly MockWorkspaceFolder[] | undefined {
    return mockState.workspaceFolders;
  },
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback: T): T {
        const stored = mockState.configuration.get(`${section}.${key}`);
        return stored === undefined ? fallback : (stored as T);
      },
    };
  },
  async openTextDocument(uri: Uri): Promise<MockTextDocument> {
    const content = await fs.readFile(uri.fsPath, "utf8");
    return createDocument(uri, content);
  },
  registerTextDocumentContentProvider(scheme: string, provider: unknown): Disposable {
    mockState.contentProviders.set(scheme, provider);
    return new Disposable(() => mockState.contentProviders.delete(scheme));
  },
};

/** Builds a document from text, for tests that do not want a file on disk. */
export function documentFromText(fsPath: string, content: string): MockTextDocument {
  return createDocument(Uri.file(fsPath), content);
}

function createDocument(uri: Uri, content: string): MockTextDocument {
  const lines = content.split("\n");
  return {
    uri,
    fileName: uri.fsPath,
    lineCount: lines.length,
    getText: () => content,
    lineAt: (line: number) => {
      const text = lines[line];
      if (text === undefined) {
        throw new Error(`line ${String(line)} is out of range`);
      }
      return { text };
    },
  };
}

export const window = {
  get visibleTextEditors(): readonly MockTextEditor[] {
    return mockState.visibleTextEditors;
  },
  get activeTextEditor(): MockTextEditor | undefined {
    return mockState.activeTextEditor;
  },
  onDidChangeVisibleTextEditors(listener: (editors: readonly MockTextEditor[]) => void): Disposable {
    return mockState.onDidChangeVisibleEditors.event(listener);
  },
  createOutputChannel(_name: string, _options?: unknown): MockLogOutputChannel {
    const lines: string[] = [];
    const channel: MockLogOutputChannel = {
      lines,
      appendLine: (value: string) => lines.push(value),
      info: (value: string) => lines.push(`info: ${value}`),
      warn: (value: string) => lines.push(`warn: ${value}`),
      error: (value: string) => lines.push(`error: ${value}`),
      show: () => undefined,
      dispose: () => undefined,
    };
    mockState.outputChannels.push(channel);
    return channel;
  },
  createTextEditorDecorationType(options: unknown): MockDecorationType {
    mockState.decorationCounter += 1;
    const decoration: MockDecorationType = {
      id: mockState.decorationCounter,
      options,
      dispose: () => undefined,
    };
    mockState.decorationTypes.push(decoration);
    return decoration;
  },
  createStatusBarItem(_alignment: number, _priority?: number): MockStatusBarItem {
    const item: MockStatusBarItem = {
      text: "",
      tooltip: undefined,
      command: undefined,
      visible: false,
      show: () => {
        item.visible = true;
      },
      hide: () => {
        item.visible = false;
      },
      dispose: () => undefined,
    };
    mockState.statusBarItems.push(item);
    return item;
  },
  showTextDocument(document: MockTextDocument, _options?: unknown): Promise<MockTextEditor> {
    const existing = mockState.visibleTextEditors.find(
      (editor) => editor.document.uri.fsPath === document.uri.fsPath,
    );
    if (existing !== undefined) {
      mockState.activeTextEditor = existing;
      return Promise.resolve(existing);
    }
    const editor: MockTextEditor = {
      document,
      decorations: [],
      revealed: undefined,
      selection: undefined,
      setDecorations: (decoration, ranges) => {
        editor.decorations.push({ decoration, ranges });
      },
      revealRange: (range) => {
        editor.revealed = range;
      },
    };
    mockState.visibleTextEditors.push(editor);
    mockState.activeTextEditor = editor;
    return Promise.resolve(editor);
  },
  showInformationMessage(message: string, ..._rest: unknown[]): Promise<string | undefined> {
    mockState.shownMessages.push(message);
    return Promise.resolve(mockState.informationResponses.shift());
  },
  showWarningMessage(message: string, ..._rest: unknown[]): Promise<string | undefined> {
    mockState.shownMessages.push(message);
    return Promise.resolve(mockState.warningResponses.shift());
  },
  withProgress<T>(_options: unknown, task: () => Promise<T>): Promise<T> {
    return task();
  },
  registerWebviewViewProvider(identifier: string, provider: unknown): Disposable {
    mockState.webviewProviders.set(identifier, provider);
    return new Disposable(() => mockState.webviewProviders.delete(identifier));
  },
  showQuickPick(items: unknown[], _options?: unknown): Promise<unknown> {
    mockState.quickPickRequests.push(items);
    return Promise.resolve(mockState.quickPickResponses.shift());
  },
  registerTreeDataProvider(identifier: string, provider: unknown): Disposable {
    mockState.treeDataProviders.set(identifier, provider);
    return new Disposable(() => mockState.treeDataProviders.delete(identifier));
  },
};

export const languages = {
  registerCodeLensProvider(_selector: unknown, provider: unknown): Disposable {
    mockState.codeLensProviders.push(provider);
    return new Disposable(() => {
      const index = mockState.codeLensProviders.indexOf(provider);
      if (index >= 0) {
        mockState.codeLensProviders.splice(index, 1);
      }
    });
  },
};

export const commands = {
  registerCommand(identifier: string, callback: (...args: unknown[]) => unknown): Disposable {
    mockState.registeredCommands.set(identifier, callback);
    return new Disposable(() => mockState.registeredCommands.delete(identifier));
  },
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    mockState.executedCommands.push({ command, args });
    const handler = mockState.registeredCommands.get(command);
    return handler === undefined ? undefined : await handler(...args);
  },
};

export const env = {
  openExternal: (target: Uri): Promise<boolean> => {
    mockState.executedCommands.push({ command: "openExternal", args: [target] });
    return Promise.resolve(true);
  },
};
