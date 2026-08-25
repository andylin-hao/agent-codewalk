import path from "node:path";
import { promises as fs } from "node:fs";

import * as vscode from "vscode";

import { resolveAnchor } from "./anchors.js";
import type { StepDiffProvider } from "./diff.js";
import { SessionStore, type StoredWalkthrough } from "./storage.js";
import type {
  ChangeKind,
  ExplanationMode,
  SessionSummary,
  StepGroup,
  StepSummary,
  ViewState,
  WalkthroughStep,
} from "./types.js";

/** Slowest acceptable fallback poll when the filesystem watch cannot be trusted. */
const MINIMUM_REFRESH_MILLISECONDS = 500;
const MAXIMUM_REFRESH_MILLISECONDS = 30_000;

/** One step of a document, already resolved against its current content. */
export interface LocatedStep {
  readonly step: WalkthroughStep;
  readonly position: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly active: boolean;
}

export class WalkthroughPlayer implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<ViewState>();
  private readonly publishEmitter = new vscode.EventEmitter<StoredWalkthrough>();
  private sessions: readonly StoredWalkthrough[] = [];
  private active: StoredWalkthrough | undefined;
  private mode: ExplanationMode = "file";
  private index = 0;
  private stale = false;
  private relocated = false;
  private error: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private watcher: vscode.Disposable | undefined;
  private known = new Set<string>();
  private started = false;

  /** Fires whenever the rendered state changes. */
  public readonly onDidChangeState = this.stateEmitter.event;

  /** Fires when a session appears that this session has not seen before. */
  public readonly onDidPublishSession = this.publishEmitter.event;

  public constructor(
    private readonly store: SessionStore,
    private readonly decorations: Readonly<Record<ChangeKind, vscode.TextEditorDecorationType>>,
    private readonly context: vscode.TextEditorDecorationType,
    private readonly diffs: StepDiffProvider,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  public start(): void {
    const configured = vscode.workspace
      .getConfiguration("agentCodeWalk")
      .get<number>("refreshInterval", 4000);
    const interval = Math.max(
      MINIMUM_REFRESH_MILLISECONDS,
      Math.min(configured, MAXIMUM_REFRESH_MILLISECONDS),
    );
    this.refreshTimer = setInterval(() => void this.refresh(), interval);
    this.watcher = this.store.watch(() => void this.refresh());
    // Emit once after the first load even when nothing was published, so that the
    // status bar and the `hasSession` context key start from a known state.
    void this.refresh().then(() => {
      this.emit();
    });
  }

  public async refresh(): Promise<void> {
    const result = await this.store.load();
    const previous = this.sessions.map((session) => session.walkthrough.id).join("\0");
    this.sessions = result.sessions;
    if (this.active !== undefined) {
      const identifier = this.active.walkthrough.id;
      this.active = this.sessions.find((session) => session.walkthrough.id === identifier);
    }
    if (this.active === undefined) {
      this.active = this.sessions[0];
      this.index = 0;
    }
    this.error =
      result.errors.length > 0
        ? `${String(result.errors.length)} session file(s) were ignored as invalid.`
        : undefined;
    this.announceNewSessions();
    if (previous !== this.sessions.map((session) => session.walkthrough.id).join("\0")) {
      this.emit();
    } else if (result.errors.length > 0) {
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

  public async selectStep(stepId: string): Promise<void> {
    const position = this.order().indexOf(stepId);
    if (position < 0) {
      this.error = "That step is not part of the active walkthrough.";
      this.emit();
      return;
    }
    this.index = position;
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
    await this.setMode(this.mode === "file" ? "flow" : "file");
  }

  /** Switches order while keeping the reader on the step they were looking at. */
  public async setMode(mode: ExplanationMode): Promise<void> {
    const currentIdentifier = this.currentStep()?.id;
    this.mode = mode;
    if (currentIdentifier !== undefined) {
      const position = this.order().indexOf(currentIdentifier);
      this.index = position < 0 ? 0 : position;
    }
    await this.showCurrentStep();
  }

  /** Opens the before/after diff for the active step. */
  public async showDiff(): Promise<void> {
    const step = this.currentStep();
    if (step === undefined || this.active === undefined) {
      return;
    }
    if (step.previousText === undefined) {
      this.error = `“${step.title}” added new code, so there is nothing to compare it with.`;
      this.emit();
      return;
    }
    let currentText = "";
    if (step.targetAvailable) {
      try {
        const targetPath = await resolveWorkspaceFile(this.active.workspaceRoot, step.path);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        const resolved = resolveAnchor(document.getText(), step.anchor);
        currentText = sliceLines(
          document.getText(),
          resolved?.startLine ?? step.anchor.startLine,
          resolved?.endLine ?? step.anchor.endLine,
        );
      } catch (error) {
        this.output.warn(`Cannot read ${step.path} for a diff: ${errorMessage(error)}`);
      }
    }
    await this.diffs.show(step, currentText);
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
    this.emit();
  }

  /**
   * Resolves every step that points into one document, so that code lenses can be
   * attached to the code rather than only to the sidebar.
   */
  public locateSteps(documentPath: string, text: string): LocatedStep[] {
    const walkthrough = this.active?.walkthrough;
    const root = this.active?.workspaceRoot;
    if (walkthrough === undefined || root === undefined) {
      return [];
    }
    const order = this.order();
    const activeIdentifier = this.currentStep()?.id;
    const located: LocatedStep[] = [];
    for (const step of walkthrough.steps) {
      if (!step.targetAvailable) {
        continue;
      }
      if (path.resolve(root, ...step.path.split("/")) !== path.resolve(documentPath)) {
        continue;
      }
      const resolved = resolveAnchor(text, step.anchor);
      if (resolved === undefined) {
        continue;
      }
      located.push({
        step,
        position: order.indexOf(step.id) + 1,
        startLine: resolved.startLine,
        endLine: resolved.endLine,
        active: step.id === activeIdentifier,
      });
    }
    return located.sort((left, right) => left.startLine - right.startLine);
  }

  public getState(): ViewState {
    const walkthrough = this.active?.walkthrough;
    const step = this.currentStep();
    const steps = this.stepSummaries();
    return {
      sessions: this.sessions.map(
        (session): SessionSummary => ({
          id: session.walkthrough.id,
          title: session.walkthrough.title,
          createdAt: session.walkthrough.createdAt,
          stepCount: session.walkthrough.steps.length,
          agent: session.walkthrough.agent.kind,
        }),
      ),
      ...(walkthrough === undefined
        ? {}
        : {
            activeSessionId: walkthrough.id,
            title: walkthrough.title,
            summary: walkthrough.summary,
            goal: walkthrough.task.goal,
            agent: walkthrough.agent.kind,
          }),
      mode: this.mode,
      ...(step === undefined ? {} : { step }),
      stepNumber: step === undefined ? 0 : this.index + 1,
      stepCount: this.order().length,
      steps,
      groups: groupByFile(steps),
      stale: this.stale,
      relocated: this.relocated,
      canShowDiff: step?.previousText !== undefined,
      degradedBaseline: walkthrough?.degradedBaseline ?? false,
      uncoveredHunks: walkthrough?.uncoveredHunks ?? [],
      excludedChanges: walkthrough?.excludedChanges ?? [],
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  public dispose(): void {
    if (this.refreshTimer !== undefined) {
      clearInterval(this.refreshTimer);
    }
    this.watcher?.dispose();
    this.clearDecorations();
    this.stateEmitter.dispose();
    this.publishEmitter.dispose();
  }

  private announceNewSessions(): void {
    const identifiers = new Set(this.sessions.map((session) => session.walkthrough.id));
    if (!this.started) {
      // The first load is the existing backlog, not something published just now.
      this.started = true;
      this.known = identifiers;
      return;
    }
    for (const session of this.sessions) {
      if (!this.known.has(session.walkthrough.id)) {
        this.publishEmitter.fire(session);
      }
    }
    this.known = identifiers;
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
      this.error = `${step.path} was deleted, so there is no current code block to open.`;
      this.emit();
      return;
    }
    try {
      const targetPath = await resolveWorkspaceFile(this.active.workspaceRoot, step.path);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
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
      const range = lineRange(document, resolved.startLine, resolved.endLine);
      const hover = new vscode.MarkdownString();
      hover.appendMarkdown(`**${escapeMarkdown(step.title)}**\n\n`);
      hover.appendText(step.explanation);
      editor.setDecorations(this.decorations[step.changeKind], [{ range, hoverMessage: hover }]);
      editor.setDecorations(
        this.context,
        this.locateSteps(targetPath, document.getText())
          .filter((located) => !located.active)
          .map((located) => ({
            range: lineRange(document, located.startLine, located.endLine),
            hoverMessage: new vscode.MarkdownString(
              `Agent CodeWalk step ${String(located.position)}: ${escapeMarkdown(located.step.title)}`,
            ),
          })),
      );
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      this.relocated = resolved.relocated;
    } catch (error) {
      this.stale = true;
      this.error = `Cannot open ${step.path}: ${errorMessage(error)}`;
      this.output.appendLine(this.error);
    }
    this.emit();
  }

  private stepSummaries(): StepSummary[] {
    const walkthrough = this.active?.walkthrough;
    if (walkthrough === undefined) {
      return [];
    }
    const activeIdentifier = this.currentStep()?.id;
    return this.order().flatMap((identifier, position) => {
      const step = walkthrough.steps.find((candidate) => candidate.id === identifier);
      if (step === undefined) {
        return [];
      }
      return [
        {
          id: step.id,
          position: position + 1,
          title: step.title,
          path: step.path,
          startLine: step.anchor.startLine,
          changeKind: step.changeKind,
          hasDiff: step.previousText !== undefined,
          flowAfter: step.flowAfter,
          active: step.id === activeIdentifier,
        },
      ];
    });
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
      for (const decoration of [...Object.values(this.decorations), this.context]) {
        editor.setDecorations(decoration, []);
      }
    }
  }

  private emit(): void {
    this.stateEmitter.fire(this.getState());
  }
}

/** Groups the ordered steps by file while preserving their order of first appearance. */
export function groupByFile(steps: readonly StepSummary[]): StepGroup[] {
  const groups = new Map<string, StepSummary[]>();
  for (const step of steps) {
    const existing = groups.get(step.path);
    if (existing === undefined) {
      groups.set(step.path, [step]);
    } else {
      existing.push(step);
    }
  }
  return [...groups].map(([groupPath, groupSteps]) => ({ path: groupPath, steps: groupSteps }));
}

function lineRange(
  document: { lineAt: (line: number) => { text: string } },
  startLine: number,
  endLine: number,
): vscode.Range {
  const end = endLine - 1;
  return new vscode.Range(startLine - 1, 0, end, document.lineAt(end).text.length);
}

function sliceLines(text: string, startLine: number, endLine: number): string {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n");
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/[\\`*_{}[\]()#+\-.!]/gu, (character) => `\\${character}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves a walkthrough path against the recorded workspace root and refuses anything
 * that escapes it, including through symbolic links.
 */
async function resolveWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
  const root = await fs.realpath(workspaceRoot);
  const candidate = await fs.realpath(path.join(root, ...relativePath.split("/")));
  const relative = path.relative(root, candidate);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("walkthrough target resolves outside the workspace");
  }
  return candidate;
}
