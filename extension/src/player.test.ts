import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { StepDiffProvider } from "./diff.js";
import { WalkthroughPlayer, changedRangesWithin, groupByFile } from "./player.js";
import { SessionStore } from "./storage.js";
import type { ChangeKind, StepSummary } from "./types.js";
import {
  buildStep,
  buildWalkthrough,
  createTemporaryWorkspace,
  writeSession,
  writeWorkspaceFile,
} from "./test/fixtures.js";
import {
  mockState,
  resetVscodeMock,
  setWorkspaceFolders,
  type MockDecorationType,
  type MockTextEditor,
} from "./test/vscode-mock.js";

const LIB_SOURCE = ["pub fn ready() -> bool {", "    true", "}", ""].join("\n");
const MAIN_SOURCE = ["fn main() {", "    start(ready());", "}", ""].join("\n");

let workspace: Awaited<ReturnType<typeof createTemporaryWorkspace>>;
let player: WalkthroughPlayer;
let diffs: StepDiffProvider;
let decorations: Record<ChangeKind, MockDecorationType>;
let contextDecoration: MockDecorationType;

beforeEach(async () => {
  resetVscodeMock();
  workspace = await createTemporaryWorkspace();
  vi.stubEnv("AGENT_CODEWALK_HOME", workspace.dataDirectory);
  setWorkspaceFolders([workspace.workspaceRoot]);
  await writeWorkspaceFile(workspace.workspaceRoot, "src/lib.rs", LIB_SOURCE);
  await writeWorkspaceFile(workspace.workspaceRoot, "src/main.rs", MAIN_SOURCE);
  decorations = {
    add: createDecoration(),
    modify: createDecoration(),
    delete: createDecoration(),
    rename: createDecoration(),
    context: createDecoration(),
  };
  contextDecoration = createDecoration();
  diffs = new StepDiffProvider();
  player = new WalkthroughPlayer(
    new SessionStore(vscode.window.createOutputChannel("test", { log: true })),
    decorations as unknown as Record<ChangeKind, vscode.TextEditorDecorationType>,
    contextDecoration as unknown as vscode.TextEditorDecorationType,
    diffs,
    vscode.window.createOutputChannel("test", { log: true }),
  );
});

afterEach(async () => {
  player.dispose();
  diffs.dispose();
  vi.unstubAllEnvs();
  await workspace.cleanup();
});

function createDecoration(): MockDecorationType {
  return vscode.window.createTextEditorDecorationType({}) as unknown as MockDecorationType;
}

/** The ranges most recently applied with one decoration type. */
function lastRanges(editor: MockTextEditor, decoration: MockDecorationType): [number, number][] {
  const call = [...editor.decorations].reverse().find((entry) => entry.decoration === decoration);
  return (call?.ranges ?? []).map((entry) => [entry.range.start.line, entry.range.end.line]);
}

function editorFor(relativePath: string): MockTextEditor {
  const target = path.join(workspace.workspaceRoot, ...relativePath.split("/"));
  const editor = mockState.visibleTextEditors.find(
    (candidate) => candidate.document.uri.fsPath === target,
  );
  if (editor === undefined) {
    throw new Error(`no editor was opened for ${relativePath}`);
  }
  return editor;
}

async function publishTwoStepSession(): Promise<void> {
  const walkthrough = buildWalkthrough(
    workspace.workspaceRoot,
    [
      buildStep({
        id: "ready",
        path: "src/lib.rs",
        startLine: 1,
        endLine: 3,
        text: "pub fn ready() -> bool {\n    true\n}",
        title: "Expose readiness",
        changeKind: "add",
      }),
      buildStep({
        id: "caller",
        path: "src/main.rs",
        startLine: 2,
        endLine: 2,
        text: "    start(ready());",
        title: "Consult the helper",
        flowAfter: ["ready"],
        previousText: "    start();",
      }),
    ],
    { fileOrder: ["ready", "caller"], flowOrder: ["ready", "caller"] },
  );
  await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
}

describe("changedRangesWithin", () => {
  const hunks = [
    { path: "src/lib.rs", startLine: 12, endLine: 13, kind: "modify" as const },
    { path: "src/main.rs", startLine: 12, endLine: 13, kind: "add" as const },
  ];

  it("keeps only the hunks of this file, clipped to the block", () => {
    expect(changedRangesWithin(hunks, "src/lib.rs", { startLine: 10 }, { startLine: 10, endLine: 12 })).toEqual([
      { startLine: 12, endLine: 12 },
    ]);
  });

  it("shifts a hunk by however far the block moved", () => {
    // Published at 10, found at 14: everything inside it slid down four lines.
    expect(changedRangesWithin(hunks, "src/lib.rs", { startLine: 10 }, { startLine: 14, endLine: 20 })).toEqual([
      { startLine: 16, endLine: 17 },
    ]);
  });

  it("merges runs that touch so the editor draws one band", () => {
    const adjacent = [
      { path: "a.ts", startLine: 2, endLine: 3, kind: "modify" as const },
      { path: "a.ts", startLine: 4, endLine: 5, kind: "modify" as const },
      { path: "a.ts", startLine: 9, endLine: 9, kind: "modify" as const },
    ];
    expect(changedRangesWithin(adjacent, "a.ts", { startLine: 1 }, { startLine: 1, endLine: 10 })).toEqual([
      { startLine: 2, endLine: 5 },
      { startLine: 9, endLine: 9 },
    ]);
  });

  it("returns nothing when no hunk reaches the block", () => {
    expect(changedRangesWithin(hunks, "src/lib.rs", { startLine: 1 }, { startLine: 1, endLine: 5 })).toEqual([]);
  });
});

/** A walkthrough with one step detailing another, for the nesting tests. */
async function publishNestedSession(): Promise<void> {
  const walkthrough = buildWalkthrough(workspace.workspaceRoot, [
    buildStep({
      id: "ready",
      path: "src/lib.rs",
      startLine: 1,
      endLine: 3,
      text: "pub fn ready() -> bool {\n    true\n}",
      title: "Expose readiness",
    }),
    buildStep({
      id: "ready-body",
      parentId: "ready",
      depth: 1,
      path: "src/lib.rs",
      startLine: 2,
      endLine: 2,
      text: "    true",
      title: "Always ready for now",
    }),
    buildStep({
      id: "caller",
      path: "src/main.rs",
      startLine: 2,
      endLine: 2,
      text: "    start(ready());",
      title: "Consult the helper",
    }),
  ]);
  await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
}

describe("WalkthroughPlayer", () => {
  it("opens the first step and highlights its block", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    const state = player.getState();
    expect(state.stepNumber).toBe(1);
    expect(state.stepCount).toBe(2);
    expect(state.step?.title).toBe("Expose readiness");
    expect(state.stale).toBe(false);
    expect(lastRanges(editorFor("src/lib.rs"), decorations.add)).toEqual([[0, 2]]);
  });

  it("moves between steps and clamps at both ends", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    await player.previous();
    expect(player.getState().stepNumber).toBe(1);

    await player.next();
    expect(player.getState().step?.title).toBe("Consult the helper");

    await player.next();
    expect(player.getState().stepNumber).toBe(2);
  });

  it("jumps directly to a step by identifier", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    await player.selectStep("caller");
    expect(player.getState().step?.id).toBe("caller");
  });

  it("reports an unknown step instead of moving", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    await player.selectStep("missing");
    expect(player.getState().error).toMatch(/not part of the active walkthrough/u);
    expect(player.getState().step?.id).toBe("ready");
  });

  it("keeps the reader on the same step when the order changes", async () => {
    const walkthrough = buildWalkthrough(
      workspace.workspaceRoot,
      [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
        }),
        buildStep({
          id: "caller",
          path: "src/main.rs",
          startLine: 2,
          endLine: 2,
          text: "    start(ready());",
        }),
      ],
      { fileOrder: ["ready", "caller"], flowOrder: ["caller", "ready"] },
    );
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(player.getState().mode).toBe("graph");
    expect(player.getState().step?.id).toBe("caller");
    expect(player.getState().stepNumber).toBe(1);
    await player.switchMode();
    const state = player.getState();
    expect(state.mode).toBe("file");
    expect(state.step?.id).toBe("caller");
    expect(state.stepNumber).toBe(2);
  });

  it("marks only the changed lines inside a block, and the block itself neutrally", async () => {
    const walkthrough = {
      ...buildWalkthrough(workspace.workspaceRoot, [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
          changeKind: "modify",
        }),
      ]),
      // Only the middle line of the block actually changed.
      changedHunks: [
        { path: "src/lib.rs", startLine: 2, endLine: 2, kind: "modify" as const },
      ],
    };
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    const editor = editorFor("src/lib.rs");
    expect(lastRanges(editor, decorations.modify)).toEqual([[1, 1]]);
    expect(lastRanges(editor, decorations.context)).toEqual([[0, 2]]);
  });

  it("falls back to marking the whole block when nothing narrows it", async () => {
    const walkthrough = {
      ...buildWalkthrough(workspace.workspaceRoot, [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
          changeKind: "modify",
        }),
      ]),
      changedHunks: [],
    };
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(lastRanges(editorFor("src/lib.rs"), decorations.modify)).toEqual([[0, 2]]);
  });

  it("marks a block stale when the code no longer matches", async () => {
    await publishTwoStepSession();
    await writeWorkspaceFile(
      workspace.workspaceRoot,
      "src/lib.rs",
      "pub fn ready() -> bool {\n    false\n}\n",
    );
    await player.openLatest();

    const state = player.getState();
    expect(state.stale).toBe(true);
    expect(state.error).toMatch(/moved or changed ambiguously/u);
  });

  it("follows a block that moved to exactly one new location", async () => {
    await publishTwoStepSession();
    await writeWorkspaceFile(
      workspace.workspaceRoot,
      "src/lib.rs",
      `// a new header comment\n\n${LIB_SOURCE}`,
    );
    await player.openLatest();

    const state = player.getState();
    expect(state.relocated).toBe(true);
    expect(state.stale).toBe(false);
    expect(lastRanges(editorFor("src/lib.rs"), decorations.add)).toEqual([[2, 4]]);
  });

  it("refuses to guess when a block appears more than once", async () => {
    await publishTwoStepSession();
    await writeWorkspaceFile(
      workspace.workspaceRoot,
      "src/lib.rs",
      `// a new header comment\n${LIB_SOURCE}${LIB_SOURCE}`,
    );
    await player.openLatest();

    expect(player.getState().stale).toBe(true);
    expect(mockState.visibleTextEditors).toHaveLength(0);
  });

  it("explains a deleted target instead of opening a file", async () => {
    const walkthrough = buildWalkthrough(workspace.workspaceRoot, [
      buildStep({
        id: "gone",
        path: "src/removed.rs",
        startLine: 1,
        endLine: 1,
        text: "",
        targetAvailable: false,
        changeKind: "delete",
      }),
    ]);
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(player.getState().error).toMatch(/was deleted/u);
    expect(mockState.visibleTextEditors).toHaveLength(0);
  });

  it("reports a missing file rather than throwing", async () => {
    const walkthrough = buildWalkthrough(workspace.workspaceRoot, [
      buildStep({ id: "absent", path: "src/absent.rs", startLine: 1, endLine: 1, text: "x" }),
    ]);
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(player.getState().error).toMatch(/Cannot open src\/absent\.rs/u);
    expect(player.getState().stale).toBe(true);
  });

  it("refuses a target that escapes the workspace through a symbolic link", async () => {
    const outside = path.join(workspace.workspaceRoot, "..", "outside.rs");
    await fs.writeFile(outside, "secret\n", "utf8");
    await fs.symlink(outside, path.join(workspace.workspaceRoot, "link.rs"));
    const walkthrough = buildWalkthrough(workspace.workspaceRoot, [
      buildStep({ id: "escape", path: "link.rs", startLine: 1, endLine: 1, text: "secret" }),
    ]);
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(player.getState().error).toMatch(/outside the workspace/u);
  });

  it("marks the other steps of the same file more quietly", async () => {
    const walkthrough = buildWalkthrough(workspace.workspaceRoot, [
      buildStep({
        id: "first",
        path: "src/lib.rs",
        startLine: 1,
        endLine: 1,
        text: "pub fn ready() -> bool {",
      }),
      buildStep({ id: "second", path: "src/lib.rs", startLine: 3, endLine: 3, text: "}" }),
    ]);
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(lastRanges(editorFor("src/lib.rs"), decorations.modify)).toEqual([[0, 0]]);
    expect(lastRanges(editorFor("src/lib.rs"), contextDecoration)).toEqual([[2, 2]]);
  });

  it("opens two levels by default, and closes one on request", async () => {
    await publishNestedSession();
    await player.openLatest();

    expect(player.getState().steps.map((step) => step.id)).toEqual([
      "ready",
      "ready-body",
      "caller",
    ]);
    await player.toggleStep("ready");
    expect(player.getState().steps.map((step) => step.id)).toEqual(["ready", "caller"]);
  });

  it("opens a closed step rather than stepping over its detail", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.toggleStep("ready");
    expect(player.getState().step?.id).toBe("ready");

    await player.next();
    expect(player.getState().step?.id).toBe("ready-body");
  });

  it("reaches every level by pressing next alone", async () => {
    // The point of opening on the way through: a reader who only presses next must
    // still see the detail, whatever the initial depth hid.
    await publishNestedSession();
    await player.openLatest();
    await player.collapseAll();

    const visited: string[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      visited.push(player.getState().step?.id ?? "");
      await player.next();
    }
    expect(visited).toEqual(["ready", "ready-body", "caller"]);
  });

  it("moves to the next sibling once a step is already open", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.selectStep("ready-body");

    await player.next();
    expect(player.getState().step?.id).toBe("caller");
  });

  it("reveals a step selected from outside the visible list", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.toggleStep("ready");

    await player.selectStep("ready-body");
    const state = player.getState();
    expect(state.step?.id).toBe("ready-body");
    expect(state.steps.map((step) => step.id)).toContain("ready-body");
  });

  it("opens a step when it is chosen, not only when next reaches it", async () => {
    // Clicking a row is the same intent as reading on, so it reveals the detail too.
    await publishNestedSession();
    await player.openLatest();
    await player.collapseAll();

    await player.selectStep("ready");
    expect(player.getState().steps.map((step) => step.id)).toEqual([
      "ready",
      "ready-body",
      "caller",
    ]);
  });

  it("folds a step away when it is clicked a second time", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.collapseAll();

    await player.activateStep("ready");
    expect(player.getState().steps.map((step) => step.id)).toContain("ready-body");

    await player.activateStep("ready");
    const state = player.getState();
    expect(state.steps.map((step) => step.id)).toEqual(["ready", "caller"]);
    expect(state.step?.id).toBe("ready");
  });

  it("opens again on a third click", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.collapseAll();

    await player.activateStep("ready");
    await player.activateStep("ready");
    await player.activateStep("ready");
    expect(player.getState().steps.map((step) => step.id)).toContain("ready-body");
  });

  it("opens rather than folds a step the reader was not already on", async () => {
    // Clicking away from the current step is navigation, not a fold.
    await publishNestedSession();
    await player.openLatest();
    await player.selectStep("caller");

    await player.activateStep("ready");
    const state = player.getState();
    expect(state.step?.id).toBe("ready");
    expect(state.steps.map((step) => step.id)).toContain("ready-body");
  });

  it("never folds when a step is named from somewhere else", async () => {
    // A code lens or the search reveals; it must not undo what the reader opened.
    await publishNestedSession();
    await player.openLatest();
    await player.selectStep("ready");

    await player.selectStep("ready");
    expect(player.getState().steps.map((step) => step.id)).toContain("ready-body");
  });

  it("keeps a step closed when the reader folds it away", async () => {
    // Collapsing must not bounce through selection, which would reopen it at once.
    await publishNestedSession();
    await player.openLatest();
    await player.selectStep("ready");

    await player.toggleStep("ready");
    const state = player.getState();
    expect(state.step?.id).toBe("ready");
    expect(state.steps.map((step) => step.id)).toEqual(["ready", "caller"]);
  });

  it("shows the file list at the same depth as the graph", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.collapseAll();
    await player.setMode("file");

    expect(player.getState().steps.map((step) => step.id)).toEqual(["ready", "caller"]);
    await player.toggleStep("ready");
    expect(player.getState().steps.map((step) => step.id)).toContain("ready-body");
  });

  it("moves the reader up when the step they are on is collapsed away", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.selectStep("ready-body");

    await player.toggleStep("ready");
    expect(player.getState().step?.id).toBe("ready");
  });

  it("counts the hidden children of a closed step", async () => {
    await publishNestedSession();
    await player.openLatest();
    await player.toggleStep("ready");

    const node = player.getState().graph.nodes.find((entry) => entry.id === "ready");
    expect(node?.hasChildren).toBe(true);
    expect(node?.expanded).toBe(false);
    expect(node?.childCount).toBe(1);
  });

  it("opens every level and closes back to the top", async () => {
    await publishNestedSession();
    await player.openLatest();

    await player.toggleStep("ready");
    await player.expandAll();
    expect(player.getState().steps).toHaveLength(3);
    await player.collapseAll();
    expect(player.getState().steps.map((step) => step.id)).toEqual(["ready", "caller"]);
  });

  it("opens in the graph and toggles to the file list", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    expect(player.getState().mode).toBe("graph");

    const seen: string[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      await player.switchMode();
      seen.push(player.getState().mode);
    }
    expect(seen).toEqual(["file", "graph", "file"]);
  });

  it("lays out the rail for the graph view and drops it for the file list", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    const state = player.getState();
    expect(state.graph.nodes.map((node) => node.id)).toEqual(["ready", "caller"]);
    expect(state.graph.nodes.map((node) => node.lane)).toEqual([0, 0]);
    expect(state.graph.edges).toEqual([{ from: "ready", to: "caller" }]);

    await player.setMode("file");
    expect(player.getState().graph.nodes).toEqual([]);
  });

  it("groups the step list by file and marks the active row", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    const state = player.getState();
    expect(state.groups.map((group) => group.path)).toEqual(["src/lib.rs", "src/main.rs"]);
    expect(state.steps.filter((step) => step.active).map((step) => step.id)).toEqual(["ready"]);
    expect(state.steps[1]?.hasDiff).toBe(true);
  });

  it("plays an explanation of code that never changed", async () => {
    const walkthrough = buildWalkthrough(
      workspace.workspaceRoot,
      [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
          title: "Where readiness is decided",
          changeKind: "context",
        }),
      ],
      { kind: "explanation", title: "How readiness is decided" },
    );
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    const state = player.getState();
    expect(state.kind).toBe("explanation");
    expect(state.sessions[0]?.kind).toBe("explanation");
    expect(state.canShowDiff).toBe(false);
    expect(state.degradedBaseline).toBe(false);
    expect(state.uncoveredHunks).toEqual([]);
    expect(lastRanges(editorFor("src/lib.rs"), decorations.context)).toEqual([[0, 2]]);
  });

  it("has nothing to compare in an explanation", async () => {
    const walkthrough = buildWalkthrough(
      workspace.workspaceRoot,
      [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
          changeKind: "context",
        }),
      ],
      { kind: "explanation" },
    );
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();
    await player.showDiff();

    expect(player.getState().error).toMatch(/nothing to compare/u);
    expect(mockState.executedCommands.some((entry) => entry.command === "vscode.diff")).toBe(false);
  });

  it("warns when the publishing companion is behind the extension", async () => {
    const walkthrough = buildWalkthrough(
      workspace.workspaceRoot,
      [buildStep({ id: "ready", path: "src/lib.rs", startLine: 1, endLine: 1, text: "pub fn ready() -> bool {" })],
      { companionVersion: "0.0.1" },
    );
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    expect(player.getState().staleCompanion).toBe("0.0.1");
  });

  it("stays quiet about a session that recorded no companion version", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    expect(player.getState().staleCompanion).toBeUndefined();
  });

  it("reports a change walkthrough as such", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    expect(player.getState().kind).toBe("change");
    expect(player.getState().sessions[0]?.kind).toBe("change");
  });

  it("surfaces degraded baselines and unexplained changes", async () => {
    const walkthrough = buildWalkthrough(
      workspace.workspaceRoot,
      [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
        }),
      ],
      {
        degradedBaseline: true,
        uncoveredHunks: [{ path: "src/other.rs", startLine: 4, endLine: 6, kind: "modify" }],
      },
    );
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, walkthrough);
    await player.openLatest();

    const state = player.getState();
    expect(state.degradedBaseline).toBe(true);
    expect(state.uncoveredHunks).toHaveLength(1);
  });

  it("opens a diff for a step that recorded what it replaced", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    await player.selectStep("caller");
    await player.showDiff();

    const diff = mockState.executedCommands.find((entry) => entry.command === "vscode.diff");
    expect(diff).toBeDefined();
    expect(String(diff?.args[2])).toMatch(/before ↔ after/u);
  });

  it("says why a purely added step has nothing to compare", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    await player.showDiff();

    expect(player.getState().error).toMatch(/nothing to compare/u);
    expect(mockState.executedCommands.some((entry) => entry.command === "vscode.diff")).toBe(false);
  });

  it("locates every resolvable step of a document for the code lenses", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    const located = player.locateSteps(
      path.join(workspace.workspaceRoot, "src", "lib.rs"),
      LIB_SOURCE,
    );
    expect(located).toHaveLength(1);
    expect(located[0]?.position).toBe(1);
    expect(located[0]?.active).toBe(true);
  });

  it("deletes the active session and clears the view", async () => {
    await publishTwoStepSession();
    await player.openLatest();
    const sessionPath = path.join(
      workspace.dataDirectory,
      "workspaces",
    );
    await player.deleteActive();

    expect(player.getState().step).toBeUndefined();
    expect(player.getState().sessions).toHaveLength(0);
    expect(await fs.readdir(sessionPath)).toHaveLength(1);
  });

  it("announces only sessions published after the first load", async () => {
    await publishTwoStepSession();
    const announced: string[] = [];
    player.onDidPublishSession((session) => announced.push(session.walkthrough.id));

    await player.refresh();
    expect(announced).toEqual([]);

    const second = buildWalkthrough(
      workspace.workspaceRoot,
      [
        buildStep({
          id: "ready",
          path: "src/lib.rs",
          startLine: 1,
          endLine: 3,
          text: "pub fn ready() -> bool {\n    true\n}",
        }),
      ],
      { id: "session-2", createdAt: "2026-01-02T00:00:00Z" },
    );
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, second);
    await player.refresh();

    expect(announced).toEqual(["session-2"]);
  });

  it("reports invalid session files without hiding the valid ones", async () => {
    await publishTwoStepSession();
    await fs.writeFile(
      path.join(
        workspace.dataDirectory,
        "workspaces",
        (await fs.readdir(path.join(workspace.dataDirectory, "workspaces")))[0] ?? "",
        "sessions",
        "broken.json",
      ),
      "{ not json",
      "utf8",
    );
    await player.refresh();

    expect(player.getState().error).toMatch(/1 session file\(s\) were ignored/u);
    expect(player.getState().sessions).toHaveLength(1);
  });

  it("loads published sessions once started", async () => {
    await publishTwoStepSession();
    player.start();
    await vi.waitFor(() => {
      expect(player.getState().sessions).toHaveLength(1);
    });
  });

  it("picks up a session published while it is already running", async () => {
    player.start();
    await vi.waitFor(() => {
      expect(player.getState().sessions).toHaveLength(0);
    });
    await publishTwoStepSession();
    await vi.waitFor(
      () => {
        expect(player.getState().sessions).toHaveLength(1);
      },
      { timeout: 8_000 },
    );
  });
});

describe("groupByFile", () => {
  it("keeps the order in which files first appear", () => {
    const steps: StepSummary[] = [
      summary("a", "src/one.rs", 1),
      summary("b", "src/two.rs", 2),
      summary("c", "src/one.rs", 3),
    ];
    expect(groupByFile(steps).map((group) => group.path)).toEqual(["src/one.rs", "src/two.rs"]);
    expect(groupByFile(steps)[0]?.steps.map((step) => step.id)).toEqual(["a", "c"]);
  });

  it("returns nothing for an empty walkthrough", () => {
    expect(groupByFile([])).toEqual([]);
  });
});

function summary(id: string, filePath: string, position: number): StepSummary {
  return {
    id,
    position,
    title: id,
    path: filePath,
    startLine: 1,
    changeKind: "modify",
    hasDiff: false,
    flowAfter: [],
    active: false,
    depth: 0,
    hasChildren: false,
    expanded: false,
  };
}
