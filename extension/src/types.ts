export type AgentKind = "codex" | "claude-code" | "opencode" | "other";
export type ChangeKind = "add" | "modify" | "delete" | "rename";
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

export interface ViewState {
  readonly sessions: readonly {
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
  }[];
  readonly activeSessionId?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly mode: ExplanationMode;
  readonly step?: WalkthroughStep;
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly stale: boolean;
  readonly relocated: boolean;
  readonly degradedBaseline: boolean;
  readonly excludedChanges: readonly ExcludedChange[];
  readonly error?: string;
}

