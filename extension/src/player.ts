import path from "node:path";
import { promises as fs } from "node:fs";

import * as vscode from "vscode";

import { resolveAnchor } from "./anchors.js";
import type { StepDiffProvider } from "./diff.js";
import { EMPTY_GRAPH, buildGraph } from "./graph.js";
import { VERSION } from "./installer.js";
import { staleCompanion } from "./staleness.js";
import { ancestorsOf, expandedForDepth, visibleOrder } from "./tree.js";
import { SessionStore, type StoredWalkthrough } from "./storage.js";
import type {
  ChangeHunk,
  ChangeKind,
  ExplanationMode,
  SessionSummary,
  StepGroup,
  StepSummary,
  StepGraph,
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
  // The graph opens first now that it shows one level at a time: a fifty-step
  // walkthrough arrives as a handful of top-level steps rather than a scroll.
  private mode: ExplanationMode = "graph";
  /** Steps whose children are showing. Seeded from `initialDepth` for each session. */
  private expanded = new Set<string>();
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
    this.resetExpansion();
    await this.showCurrentStep();
  }

  /** Opens as many levels as the reader configured, for the active walkthrough. */
  private resetExpansion(): void {
    const levels = vscode.workspace
      .getConfiguration("agentCodeWalk")
      .get<number>("initialDepth", 2);
    this.expanded = expandedForDepth(this.steps(), Math.max(1, levels));
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
    this.resetExpansion();
    await this.showCurrentStep();
  }

  /**
   * Goes to a step, revealing it and its detail.
   *
   * Ancestors are opened so a step reached from search or a code lens is visible at all.
   * The step itself is opened too, because choosing a step means reading it and its
   * children are part of that — the same thing `next` does on the way past. Folding a
   * step away again is what the disclosure control is for.
   */
  public async selectStep(stepId: string): Promise<void> {
    for (const ancestor of ancestorsOf(this.steps(), stepId)) {
      this.expanded.add(ancestor);
    }
    if (this.hasChildren(stepId)) {
      this.expanded.add(stepId);
    }
    await this.moveTo(stepId);
  }

  /**
   * Handles a click on a step's row.
   *
   * The first click opens the step and reads it; clicking the step already in front of
   * the reader folds it away again. Only a click behaves this way. A code lens, the
   * search, or a command still reveals and never folds, because collapsing something
   * the reader was not already looking at would undo work they did not ask about.
   */
  public async activateStep(stepId: string): Promise<void> {
    const isCurrent = this.currentStep()?.id === stepId;
    if (isCurrent && this.expanded.has(stepId) && this.hasChildren(stepId)) {
      await this.toggleStep(stepId);
      return;
    }
    await this.selectStep(stepId);
  }

  /** Moves to a step that is already visible, without changing what is open. */
  private async moveTo(stepId: string): Promise<void> {
    const position = this.order().indexOf(stepId);
    if (position < 0) {
      this.error = "That step is not part of the active walkthrough.";
      this.emit();
      return;
    }
    this.index = position;
    await this.showCurrentStep();
  }

  /**
   * Moves to the next step the reader should see.
   *
   * A closed parent is opened rather than stepped over. Next means "keep reading", and
   * skipping the detail would leave every level below the configured depth unreachable
   * without a mouse. Opening first means the next index lands on the first child.
   */
  public async next(): Promise<void> {
    const current = this.currentStep();
    if (current !== undefined && !this.expanded.has(current.id) && this.hasChildren(current.id)) {
      this.expanded.add(current.id);
    }
    const count = this.order().length;
    if (count === 0) {
      return;
    }
    this.index = Math.min(this.index + 1, count - 1);
    await this.showCurrentStep();
  }

  /** Whether any step names this one as its parent. */
  private hasChildren(stepId: string): boolean {
    return this.steps().some((step) => step.parentId === stepId);
  }

  public async previous(): Promise<void> {
    this.index = Math.max(this.index - 1, 0);
    await this.showCurrentStep();
  }

  public async switchMode(): Promise<void> {
    await this.setMode(this.mode === "graph" ? "file" : "graph");
  }

  /**
   * Opens or closes one step's children.
   *
   * Closing the step the reader is on would leave the cursor pointing at something no
   * longer displayed, so the selection moves up to the step being closed.
   */
  public async toggleStep(stepId: string): Promise<void> {
    if (this.expanded.has(stepId)) {
      // Read the cursor before collapsing: afterwards the index points into a shorter
      // list and would name whichever step happened to slide into its place.
      const current = this.currentStep()?.id;
      this.expanded.delete(stepId);
      if (current !== undefined && ancestorsOf(this.steps(), current).includes(stepId)) {
        await this.moveTo(stepId);
        return;
      }
    } else {
      this.expanded.add(stepId);
    }
    this.emit();
  }

  /** Opens every step that has children. */
  public async expandAll(): Promise<void> {
    this.expanded = new Set(this.steps().map((step) => step.id));
    this.emit();
    await Promise.resolve();
  }

  /** Closes everything back to the top level. */
  public async collapseAll(): Promise<void> {
    const current = this.currentStep()?.id;
    this.expanded = new Set();
    if (current !== undefined) {
      const roots = this.steps().filter((step) => step.depth === 0);
      const containing = ancestorsOf(this.steps(), current).at(-1);
      const target = containing ?? (roots.some((step) => step.id === current) ? current : undefined);
      if (target !== undefined) {
        await this.moveTo(target);
        return;
      }
    }
    this.emit();
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
    const stale = staleCompanion(walkthrough?.companionVersion, VERSION);
    const step = this.currentStep();
    const steps = this.stepSummaries();
    return {
      sessions: this.sessions.map(
        (session): SessionSummary => ({
          id: session.walkthrough.id,
          kind: session.walkthrough.kind,
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
      kind: walkthrough?.kind ?? "change",
      mode: this.mode,
      ...(step === undefined ? {} : { step }),
      stepNumber: step === undefined ? 0 : this.index + 1,
      stepCount: this.order().length,
      steps,
      groups: groupByFile(steps),
      graph: this.graph(steps),
      stale: this.stale,
      relocated: this.relocated,
      canShowDiff: step?.previousText !== undefined,
      degradedBaseline: walkthrough?.degradedBaseline ?? false,
      ...(stale === undefined ? {} : { staleCompanion: stale }),
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
      // A block usually contains more than the lines that changed. Marking the block
      // neutrally and the changed runs in their diff color shows the change in place,
      // so finding it no longer means opening the comparison.
      const changed =
        step.changeKind === "context"
          ? []
          : changedRangesWithin(this.active.walkthrough.changedHunks, step.path, step.anchor, {
              startLine: resolved.startLine,
              endLine: resolved.endLine,
            });
      if (changed.length === 0) {
        editor.setDecorations(this.decorations[step.changeKind], [{ range, hoverMessage: hover }]);
      } else {
        editor.setDecorations(this.decorations.context, [{ range, hoverMessage: hover }]);
        editor.setDecorations(
          this.decorations[step.changeKind],
          changed.map((entry) => ({
            range: lineRange(document, entry.startLine, entry.endLine),
          })),
        );
      }
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
      const hasChildren = this.hasChildren(step.id);
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
          depth: step.depth,
          hasChildren,
          expanded: hasChildren && this.expanded.has(step.id),
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

  /** Every step of the active walkthrough, or nothing when there is none. */
  private steps(): readonly WalkthroughStep[] {
    return this.active?.walkthrough.steps ?? [];
  }

  /**
   * The steps a reader can currently move between.
   *
   * Navigation follows what is displayed rather than everything published, so `Alt+]` on
   * a collapsed step goes to the next sibling instead of descending into work the reader
   * has chosen not to look at.
   */
  private order(): readonly string[] {
    const walkthrough = this.active?.walkthrough;
    if (walkthrough === undefined) {
      return [];
    }
    const published = this.mode === "file" ? walkthrough.fileOrder : walkthrough.flowOrder;
    const depths = new Map(walkthrough.steps.map((step) => [step.id, step.depth]));
    return visibleOrder(published, depths, this.expanded);
  }

  /**
   * Lays out the graph only for the view that draws it. Every navigation emits state,
   * and the layout is worthless to the two list views.
   */
  private graph(steps: readonly StepSummary[]): StepGraph {
    if (this.mode !== "graph") {
      return EMPTY_GRAPH;
    }
    const counts = new Map<string, number>();
    for (const step of this.steps()) {
      if (step.parentId !== undefined) {
        counts.set(step.parentId, (counts.get(step.parentId) ?? 0) + 1);
      }
    }
    return buildGraph(steps, counts);
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

/** A 1-based inclusive run of lines in the document currently on screen. */
export interface LineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * The parts of a step's block that the task actually changed.
 *
 * Hunks are recorded in the coordinates the file had at publication, so each one is
 * shifted by however far the anchor has since moved before being clipped to the block.
 * Touching runs are merged, because two decorations that meet render as one band anyway
 * and the editor should not be asked to draw the seam.
 *
 * @param hunks Every changed hunk in the walkthrough, across all files.
 * @param path The step's workspace-relative path.
 * @param anchor Where the block started when it was published.
 * @param block Where the block starts and ends now, after resolution.
 * @returns Disjoint spans inside the block, in ascending order.
 */
export function changedRangesWithin(
  hunks: readonly ChangeHunk[],
  path: string,
  anchor: { readonly startLine: number },
  block: LineSpan,
): LineSpan[] {
  const offset = block.startLine - anchor.startLine;
  const clipped = hunks
    .filter((hunk) => hunk.path === path)
    .map((hunk) => ({
      startLine: Math.max(block.startLine, hunk.startLine + offset),
      endLine: Math.min(block.endLine, hunk.endLine + offset),
    }))
    .filter((span) => span.startLine <= span.endLine)
    .sort((left, right) => left.startLine - right.startLine);

  const merged: LineSpan[] = [];
  for (const span of clipped) {
    const previous = merged.at(-1);
    if (previous !== undefined && span.startLine <= previous.endLine + 1) {
      merged[merged.length - 1] = {
        startLine: previous.startLine,
        endLine: Math.max(previous.endLine, span.endLine),
      };
      continue;
    }
    merged.push(span);
  }
  return merged;
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
