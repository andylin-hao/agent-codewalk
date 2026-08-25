import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { StepDiffProvider } from "./diff.js";
import { WalkthroughPlayer, groupByFile } from "./player.js";
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

    expect(player.getState().stepNumber).toBe(1);
    await player.switchMode();
    const state = player.getState();
    expect(state.mode).toBe("flow");
    expect(state.step?.id).toBe("ready");
    expect(state.stepNumber).toBe(2);
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

  it("groups the step list by file and marks the active row", async () => {
    await publishTwoStepSession();
    await player.openLatest();

    const state = player.getState();
    expect(state.groups.map((group) => group.path)).toEqual(["src/lib.rs", "src/main.rs"]);
    expect(state.steps.filter((step) => step.active).map((step) => step.id)).toEqual(["ready"]);
    expect(state.steps[1]?.hasDiff).toBe(true);
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
  };
}
