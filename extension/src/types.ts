export type AgentKind = "codex" | "claude-code" | "opencode" | "other";

/**
 * What a walkthrough explains.
 *
 * - `change`: what a task modified, validated against a recorded baseline.
 * - `explanation`: a tour of code that was not modified, published for an analysis
 *   request.
 */
export type WalkthroughKind = "change" | "explanation";

/** What a step's highlight means. `context` marks a block that did not change. */
export type ChangeKind = "add" | "modify" | "delete" | "rename" | "context";
export type ExplanationMode = "file" | "flow";

export interface CodeAnchor {
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
  readonly normalizedHash: string;
  readonly symbol?: string;
}

export interface WalkthroughStep {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly explanation: string;
  readonly changeKind: ChangeKind;
  readonly anchor: CodeAnchor;
  readonly flowAfter: readonly string[];
  readonly targetAvailable: boolean;
  /** Baseline text this step replaced, when the companion could record it. */
  readonly previousText?: string;
}

export interface ChangeHunk {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: "add" | "modify" | "delete";
}

export interface ExcludedChange {
  readonly path: string;
  readonly reason: string;
}

export interface Walkthrough {
  readonly schemaVersion: 1;
  readonly kind: WalkthroughKind;
  readonly id: string;
  readonly workspaceFingerprint: string;
  readonly title: string;
  readonly summary: string;
  readonly agent: { readonly kind: AgentKind; readonly sessionId?: string };
  readonly task: {
    readonly id: string;
    readonly goal: string;
    readonly startedAt: string;
    readonly completedAt: string;
  };
  readonly createdAt: string;
  readonly steps: readonly WalkthroughStep[];
  readonly fileOrder: readonly string[];
  readonly flowOrder: readonly string[];
  readonly changedHunks: readonly ChangeHunk[];
  readonly uncoveredHunks: readonly ChangeHunk[];
  readonly excludedChanges: readonly ExcludedChange[];
  readonly degradedBaseline: boolean;
}

export interface ResolvedAnchor {
  readonly startLine: number;
  readonly endLine: number;
  readonly relocated: boolean;
}

/** One session as offered in the session picker. */
export interface SessionSummary {
  readonly id: string;
  readonly kind: WalkthroughKind;
  readonly title: string;
  readonly createdAt: string;
  readonly stepCount: number;
  readonly agent: AgentKind;
}

/** One row of the step list, in the order currently being played. */
export interface StepSummary {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly path: string;
  readonly startLine: number;
  readonly changeKind: ChangeKind;
  readonly hasDiff: boolean;
  readonly flowAfter: readonly string[];
  readonly active: boolean;
}

/** Steps of one file, used by the by-file grouping in the step list. */
export interface StepGroup {
  readonly path: string;
  readonly steps: readonly StepSummary[];
}

export interface ViewState {
  readonly sessions: readonly SessionSummary[];
  readonly kind: WalkthroughKind;
  readonly activeSessionId?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly goal?: string;
  readonly agent?: AgentKind;
  readonly mode: ExplanationMode;
  readonly step?: WalkthroughStep;
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly steps: readonly StepSummary[];
  readonly groups: readonly StepGroup[];
  readonly stale: boolean;
  readonly relocated: boolean;
  readonly canShowDiff: boolean;
  readonly degradedBaseline: boolean;
  readonly uncoveredHunks: readonly ChangeHunk[];
  readonly excludedChanges: readonly ExcludedChange[];
  readonly error?: string;
}
