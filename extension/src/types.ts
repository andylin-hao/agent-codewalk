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
/**
 * How the step list is presented.
 *
 * - `graph`: the execution-flow order as a rail, one level at a time.
 * - `file`: every step grouped by path, in source order.
 *
 * The flat flow list was retired once the graph became hierarchical: it showed the same
 * order with less information and no way to collapse a subtree.
 */
export type ExplanationMode = "file" | "graph";

export interface CodeAnchor {
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
  readonly normalizedHash: string;
  readonly symbol?: string;
}

export interface WalkthroughStep {
  readonly id: string;
  /** The step this one details. Absent at the top level. */
  readonly parentId?: string;
  /** Distance from the top level. Zero for a session published before nesting existed. */
  readonly depth: number;
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
  /** The companion that published this session, when it recorded one. */
  readonly companionVersion?: string;
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
  readonly depth: number;
  /** True when this step details others, whether or not they are showing. */
  readonly hasChildren: boolean;
  /** True when its children are showing. Always false when it has none. */
  readonly expanded: boolean;
}

/** One node of the execution-flow rail, already assigned to a row and a lane. */
export interface GraphNode {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly path: string;
  readonly changeKind: ChangeKind;
  readonly active: boolean;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** How many steps detail this one, shown as a badge while it is closed. */
  readonly childCount: number;
  /** Column in the gutter, reused once nothing depends on its step any more. */
  readonly lane: number;
  /** Index in flow order, which is also the row this node is drawn on. */
  readonly row: number;
}

/** A dependency edge, drawn from a predecessor down to the step that follows it. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * The execution-flow rail: one node per row, dependencies drawn down the gutter.
 *
 * Rows follow flow order, so an edge always points downward and the reader never has to
 * follow a line back up the view. `laneCount` sizes the gutter the edges are drawn in.
 */
export interface StepGraph {
  readonly nodes: readonly GraphNode[];
  readonly laneCount: number;
  readonly edges: readonly GraphEdge[];
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
  readonly graph: StepGraph;
  readonly stale: boolean;
  readonly relocated: boolean;
  readonly canShowDiff: boolean;
  readonly degradedBaseline: boolean;
  /** Set when the active session came from an older companion than the one installed. */
  readonly staleCompanion?: string;
  readonly uncoveredHunks: readonly ChangeHunk[];
  readonly excludedChanges: readonly ExcludedChange[];
  readonly error?: string;
}
