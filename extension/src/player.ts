import path from "node:path";
import { promises as fs } from "node:fs";

import * as vscode from "vscode";

import { resolveAnchor } from "./anchors.js";
import { SessionStore, type StoredWalkthrough } from "./storage.js";
import type {
  ChangeKind,
  ExplanationMode,
  ViewState,
  WalkthroughStep,
} from "./types.js";

export class WalkthroughPlayer implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<ViewState>();
  private sessions: readonly StoredWalkthrough[] = [];
  private active: StoredWalkthrough | undefined;
  private mode: ExplanationMode = "file";
  private index = 0;
  private stale = false;
  private relocated = false;
  private error: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  public readonly onDidChangeState = this.stateEmitter.event;

  public constructor(
    private readonly store: SessionStore,
    private readonly decorations: Readonly<Record<ChangeKind, vscode.TextEditorDecorationType>>,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  public start(): void {
    const configured = vscode.workspace
      .getConfiguration("agentCodeWalk")
      .get<number>("refreshInterval", 2000);
    const interval = Math.max(500, Math.min(configured, 30_000));
    this.refreshTimer = setInterval(() => void this.refresh(), interval);
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    const previousIdentifiers = this.sessions.map((session) => session.walkthrough.id).join("\0");
    const result = await this.store.load();
    this.sessions = result.sessions;
    if (this.active !== undefined) {
      this.active = this.sessions.find(
        (session) => session.walkthrough.id === this.active?.walkthrough.id,
      );
    }
    if (this.active === undefined) {
      this.active = this.sessions[0];
      this.index = 0;
    }
    this.error = result.errors.length > 0 ? `${String(result.errors.length)} invalid session file(s) were ignored.` : undefined;
    const nextIdentifiers = this.sessions.map((session) => session.walkthrough.id).join("\0");
    if (previousIdentifiers !== nextIdentifiers || result.errors.length > 0) {
      this.emit();
    }
  }

  public async openLatest(): Promise<void> {
    await this.refresh();
    this.active = this.sessions[0];
    this.index = 0;
    await this.showCurrentStep();
  }

  public async select(sessionId: string): Promise<void> {
    const selected = this.sessions.find((session) => session.walkthrough.id === sessionId);
    if (selected === undefined) {
      this.error = "The selected walkthrough no longer exists.";
      this.emit();
      return;
    }
    this.active = selected;
    this.index = 0;
    await this.showCurrentStep();
  }

  public async next(): Promise<void> {
    const count = this.order().length;
    if (count === 0) {
      return;
    }
    this.index = Math.min(this.index + 1, count - 1);
    await this.showCurrentStep();
  }

  public async previous(): Promise<void> {
    this.index = Math.max(this.index - 1, 0);
    await this.showCurrentStep();
  }

  public async switchMode(): Promise<void> {
    const currentIdentifier = this.currentStep()?.id;
    this.mode = this.mode === "file" ? "flow" : "file";
    if (currentIdentifier !== undefined) {
      const newIndex = this.order().indexOf(currentIdentifier);
      this.index = newIndex < 0 ? 0 : newIndex;
    }
    await this.showCurrentStep();
  }

  public async deleteActive(): Promise<void> {
    if (this.active === undefined) {
      return;
    }
    await this.store.delete(this.active);
    this.active = undefined;
    this.index = 0;
    this.clearDecorations();
    await this.refresh();
  }

  public getState(): ViewState {
    const walkthrough = this.active?.walkthrough;
    const step = this.currentStep();
    return {
      sessions: this.sessions.map((session) => ({
        id: session.walkthrough.id,
        title: session.walkthrough.title,
        createdAt: session.walkthrough.createdAt,
      })),
      ...(walkthrough === undefined
        ? {}
        : {
            activeSessionId: walkthrough.id,
            title: walkthrough.title,
            summary: walkthrough.summary,
          }),
      mode: this.mode,
      ...(step === undefined ? {} : { step }),
      stepNumber: step === undefined ? 0 : this.index + 1,
      stepCount: this.order().length,
      stale: this.stale,
      relocated: this.relocated,
      degradedBaseline: walkthrough?.degradedBaseline ?? false,
      excludedChanges: walkthrough?.excludedChanges ?? [],
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  public dispose(): void {
    if (this.refreshTimer !== undefined) {
      clearInterval(this.refreshTimer);
    }
    this.clearDecorations();
    this.stateEmitter.dispose();
  }

  private async showCurrentStep(): Promise<void> {
    this.stale = false;
    this.relocated = false;
    this.error = undefined;
    this.clearDecorations();
    const step = this.currentStep();
    if (step === undefined || this.active === undefined) {
      this.emit();
      return;
    }
    if (!step.targetAvailable) {
      this.stale = true;
      this.error = `${step.path} was deleted; there is no current code block to open.`;
      this.emit();
      return;
    }
    try {
      const targetPath = await resolveWorkspaceFile(this.active.workspaceRoot, step.path);
      const uri = vscode.Uri.file(targetPath);
      const document = await vscode.workspace.openTextDocument(uri);
      const resolved = resolveAnchor(document.getText(), step.anchor);
      if (resolved === undefined) {
        this.stale = true;
        this.error = `The code for “${step.title}” moved or changed ambiguously.`;
        this.emit();
        return;
      }
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });
      const start = resolved.startLine - 1;
      const end = resolved.endLine - 1;
      const range = new vscode.Range(start, 0, end, document.lineAt(end).text.length);
      const hover = new vscode.MarkdownString();
      hover.appendText(step.explanation);
      editor.setDecorations(this.decorations[step.changeKind], [
        {
          range,
          hoverMessage: hover,
        },
      ]);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.relocated = resolved.relocated;
    } catch (error) {
      this.stale = true;
      this.error = `Cannot open ${step.path}: ${errorMessage(error)}`;
      this.output.appendLine(this.error);
    }
    this.emit();
  }

  private currentStep(): WalkthroughStep | undefined {
    const active = this.active?.walkthrough;
    const identifier = this.order()[this.index];
    if (active === undefined || identifier === undefined) {
      return undefined;
    }
    return active.steps.find((step) => step.id === identifier);
  }

  private order(): readonly string[] {
    const walkthrough = this.active?.walkthrough;
    if (walkthrough === undefined) {
      return [];
    }
    return this.mode === "file" ? walkthrough.fileOrder : walkthrough.flowOrder;
  }

  private clearDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      for (const decoration of Object.values(this.decorations)) {
        editor.setDecorations(decoration, []);
      }
    }
  }

  private emit(): void {
    this.stateEmitter.fire(this.getState());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
  const root = await fs.realpath(workspaceRoot);
  const candidate = await fs.realpath(path.join(root, ...relativePath.split("/")));
  const relative = path.relative(root, candidate);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("walkthrough target resolves outside the workspace");
  }
  return candidate;
}
