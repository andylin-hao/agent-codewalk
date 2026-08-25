import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { EMPTY_GRAPH } from "./graph.js";
import { activate, jumpToStep, updateStatusBar } from "./extension.js";
import type { WalkthroughPlayer } from "./player.js";
import type { StepSummary, ViewState } from "./types.js";
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
  setConfiguration,
  setWorkspaceFolders,
} from "./test/vscode-mock.js";

let workspace: Awaited<ReturnType<typeof createTemporaryWorkspace>>;
const disposables: vscode.Disposable[] = [];

beforeEach(async () => {
  resetVscodeMock();
  workspace = await createTemporaryWorkspace();
  vi.stubEnv("AGENT_CODEWALK_HOME", workspace.dataDirectory);
  setWorkspaceFolders([workspace.workspaceRoot]);
});

afterEach(async () => {
  for (const disposable of disposables.splice(0)) {
    disposable.dispose();
  }
  vi.unstubAllEnvs();
  await workspace.cleanup();
});

function activateExtension(): void {
  const context = {
    subscriptions: disposables,
    extensionPath: workspace.workspaceRoot,
    extensionUri: vscode.Uri.file(workspace.workspaceRoot),
  } as unknown as vscode.ExtensionContext;
  activate(context);
}

function emptyState(overrides: Partial<ViewState> = {}): ViewState {
  return {
    sessions: [],
    kind: "change",
    mode: "file",
    stepNumber: 0,
    stepCount: 0,
    steps: [],
    groups: [],
    graph: EMPTY_GRAPH,
    stale: false,
    relocated: false,
    canShowDiff: false,
    degradedBaseline: false,
    uncoveredHunks: [],
    excludedChanges: [],
    ...overrides,
  };
}

function summary(id: string, position: number, active: boolean): StepSummary {
  return {
    id,
    position,
    title: `Step ${id}`,
    path: "src/lib.rs",
    startLine: position * 10,
    changeKind: "modify",
    hasDiff: false,
    flowAfter: [],
    depth: 0,
    hasChildren: false,
    expanded: false,
    active,
  };
}

describe("activate", () => {
  it("registers every command the manifest contributes", () => {
    activateExtension();

    for (const identifier of [
      "agentCodeWalk.setup",
      "agentCodeWalk.openLatest",
      "agentCodeWalk.previous",
      "agentCodeWalk.next",
      "agentCodeWalk.switchMode",
      "agentCodeWalk.jumpToStep",
      "agentCodeWalk.showDiff",
      "agentCodeWalk.goToStep",
      "agentCodeWalk.showStepDiff",
      "agentCodeWalk.diagnose",
      "agentCodeWalk.delete",
      "agentCodeWalk.uninstall",
    ]) {
      expect(mockState.registeredCommands.has(identifier), identifier).toBe(true);
    }
  });

  it("registers the view, the lenses, and a status bar entry", () => {
    activateExtension();

    expect(mockState.webviewProviders.has("agentCodeWalk.walkthrough")).toBe(true);
    expect(mockState.codeLensProviders).toHaveLength(1);
    expect(mockState.statusBarItems).toHaveLength(1);
    expect(mockState.statusBarItems[0]?.command).toBe("agentCodeWalk.jumpToStep");
  });

  it("rejects a step command called without an identifier", async () => {
    activateExtension();
    const handler = mockState.registeredCommands.get("agentCodeWalk.goToStep");
    await expect(handler?.(undefined)).rejects.toThrow(/requires a step identifier/u);
  });

  it("keeps every registration disposable", () => {
    activateExtension();
    expect(disposables.length).toBeGreaterThan(10);
    expect(() => {
      for (const disposable of disposables.splice(0)) {
        disposable.dispose();
      }
    }).not.toThrow();
  });
});

describe("activated commands", () => {
  async function publishSession(identifier: string): Promise<void> {
    await writeWorkspaceFile(workspace.workspaceRoot, "src/lib.rs", "fn ready() {}\n");
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      buildWalkthrough(
        workspace.workspaceRoot,
        [
          buildStep({
            id: "ready",
            path: "src/lib.rs",
            startLine: 1,
            endLine: 1,
            text: "fn ready() {}",
          }),
        ],
        { id: identifier },
      ),
    );
  }

  it("opens the newest walkthrough and focuses the view", async () => {
    await publishSession("session-1");
    activateExtension();

    await mockState.registeredCommands.get("agentCodeWalk.openLatest")?.();

    expect(mockState.executedCommands.map((entry) => entry.command)).toContain(
      "agentCodeWalk.walkthrough.focus",
    );
    expect(mockState.visibleTextEditors).toHaveLength(1);
  });

  it("publishes a context key so the keybindings only apply with a walkthrough", async () => {
    await publishSession("session-1");
    activateExtension();
    await mockState.registeredCommands.get("agentCodeWalk.openLatest")?.();

    const contexts = mockState.executedCommands.filter((entry) => entry.command === "setContext");
    expect(contexts.at(-1)?.args).toEqual(["agentCodeWalk.hasSession", true]);
  });

  it("keeps the session when a deletion is declined", async () => {
    await publishSession("session-1");
    activateExtension();
    await mockState.registeredCommands.get("agentCodeWalk.openLatest")?.();
    mockState.warningResponses.push(undefined);

    await mockState.registeredCommands.get("agentCodeWalk.delete")?.();

    await mockState.registeredCommands.get("agentCodeWalk.openLatest")?.();
    expect(mockState.visibleTextEditors).toHaveLength(1);
  });

  it("steps forward and back through the registered commands", async () => {
    await publishSession("session-1");
    activateExtension();
    await mockState.registeredCommands.get("agentCodeWalk.openLatest")?.();

    await expect(
      mockState.registeredCommands.get("agentCodeWalk.next")?.(),
    ).resolves.not.toThrow();
    await expect(
      mockState.registeredCommands.get("agentCodeWalk.previous")?.(),
    ).resolves.not.toThrow();
    await expect(
      mockState.registeredCommands.get("agentCodeWalk.switchMode")?.(),
    ).resolves.not.toThrow();
  });

  it("offers to open a walkthrough published while the editor is running", async () => {
    activateExtension();
    await vi.waitFor(() => {
      expect(mockState.executedCommands.some((entry) => entry.command === "setContext")).toBe(true);
    });

    await publishSession("session-published");
    await vi.waitFor(
      () => {
        expect(mockState.shownMessages.join("\n")).toContain("is ready with 1 step(s)");
      },
      { timeout: 8_000 },
    );
  }, 12_000);

  it("says an explanation is ready rather than a change", async () => {
    activateExtension();
    await vi.waitFor(() => {
      expect(mockState.executedCommands.some((entry) => entry.command === "setContext")).toBe(true);
    });

    await writeWorkspaceFile(workspace.workspaceRoot, "src/lib.rs", "fn ready() {}\n");
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      buildWalkthrough(
        workspace.workspaceRoot,
        [
          buildStep({
            id: "ready",
            path: "src/lib.rs",
            startLine: 1,
            endLine: 1,
            text: "fn ready() {}",
            changeKind: "context",
          }),
        ],
        { id: "explained", kind: "explanation", title: "How readiness is decided" },
      ),
    );

    await vi.waitFor(
      () => {
        expect(mockState.shownMessages.join("\n")).toContain(
          "an explanation of “How readiness is decided” is ready",
        );
      },
      { timeout: 8_000 },
    );
  }, 12_000);

  it("stays quiet when notifications are turned off", async () => {
    setConfiguration("agentCodeWalk.notifyOnPublish", false);
    activateExtension();
    await vi.waitFor(() => {
      expect(mockState.executedCommands.some((entry) => entry.command === "setContext")).toBe(true);
    });

    await publishSession("session-published");
    await vi.waitFor(() => {
      expect(mockState.registeredCommands.size).toBeGreaterThan(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockState.shownMessages.join("\n")).not.toContain("is ready with");
  }, 12_000);
});

describe("updateStatusBar", () => {
  it("stays out of the way when nothing is playing", () => {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    updateStatusBar(item, emptyState());
    expect(mockState.statusBarItems[0]?.visible).toBe(false);
  });

  it("shows the position within the walkthrough", () => {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    updateStatusBar(item, emptyState({ stepNumber: 3, stepCount: 12 }));
    expect(mockState.statusBarItems[0]?.text).toBe("$(list-ordered) CodeWalk 3/12");
    expect(mockState.statusBarItems[0]?.visible).toBe(true);
  });
});

describe("jumpToStep", () => {
  function stubPlayer(state: ViewState): { player: WalkthroughPlayer; selected: string[] } {
    const selected: string[] = [];
    const player = {
      getState: () => state,
      selectStep: (stepId: string) => {
        selected.push(stepId);
        return Promise.resolve();
      },
    } as unknown as WalkthroughPlayer;
    return { player, selected };
  }

  it("says so when there is nothing to jump to", async () => {
    const { player, selected } = stubPlayer(emptyState());
    await jumpToStep(player);
    expect(mockState.shownMessages.at(-1)).toContain("no active Agent CodeWalk walkthrough");
    expect(selected).toEqual([]);
  });

  it("offers every step and marks the current one", async () => {
    const state = emptyState({
      title: "Add readiness helper",
      steps: [summary("a", 1, false), summary("b", 2, true)],
      stepNumber: 2,
      stepCount: 2,
    });
    const { player, selected } = stubPlayer(state);
    mockState.quickPickResponses.push({ stepId: "a" });

    await jumpToStep(player);

    const offered = mockState.quickPickRequests[0] as {
      label: string;
      description: string;
      detail?: string;
    }[];
    expect(offered.map((item) => item.label)).toEqual(["1. Step a", "2. Step b"]);
    expect(offered[0]?.description).toBe("src/lib.rs:10");
    expect(offered[1]?.detail).toBe("Current step");
    expect(selected).toEqual(["a"]);
  });

  it("does nothing when the picker is dismissed", async () => {
    const { player, selected } = stubPlayer(emptyState({ steps: [summary("a", 1, true)] }));
    mockState.quickPickResponses.push(undefined);
    await jumpToStep(player);
    expect(selected).toEqual([]);
  });
});
