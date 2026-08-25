// Extension-host assertions.
//
// These run inside a real VS Code against a workspace that already contains a
// published walkthrough, so they cover what a unit test with a fake `vscode` cannot:
// activation, command registration, real document navigation, and code lenses.

import assert from "node:assert/strict";
import path from "node:path";

import * as vscode from "vscode";

const COMMANDS = [
  "agentCodeWalk.setup",
  "agentCodeWalk.openLatest",
  "agentCodeWalk.previous",
  "agentCodeWalk.next",
  "agentCodeWalk.switchMode",
  "agentCodeWalk.jumpToStep",
  "agentCodeWalk.showDiff",
  "agentCodeWalk.diagnose",
  "agentCodeWalk.delete",
  "agentCodeWalk.uninstall",
];

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("agent-codewalk.agent-codewalk");
  assert.ok(extension, "Agent CodeWalk development extension must be discoverable");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of COMMANDS) {
    assert.ok(commands.includes(command), `Expected command to be registered: ${command}`);
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, "the test workspace must be open");

  await vscode.commands.executeCommand("agentCodeWalk.openLatest");
  await settle();

  const first = vscode.window.activeTextEditor;
  assert.ok(first, "the first step must open its file");
  assert.equal(
    normalize(first.document.uri.fsPath),
    normalize(path.join(workspaceRoot, "src", "lib.rs")),
    "the first step targets src/lib.rs",
  );
  assert.equal(first.visibleRanges.length > 0, true, "the highlighted range must be revealed");

  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
    "vscode.executeCodeLensProvider",
    first.document.uri,
  );
  const titles = lenses.map((lens) => lens.command?.title ?? "");
  assert.ok(
    titles.some((title) => title.includes("Expose readiness")),
    `a code lens must name the step, got: ${JSON.stringify(titles)}`,
  );

  await vscode.commands.executeCommand("agentCodeWalk.next");
  await settle();
  const second = vscode.window.activeTextEditor;
  assert.ok(second, "the second step must open its file");
  assert.equal(
    normalize(second.document.uri.fsPath),
    normalize(path.join(workspaceRoot, "src", "main.rs")),
    "the second step targets src/main.rs",
  );

  await vscode.commands.executeCommand("agentCodeWalk.showDiff");
  await settle();
  assert.ok(
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label.includes("before")),
    ),
    "the step diff must open a tab",
  );

  await vscode.commands.executeCommand("agentCodeWalk.switchMode");
  await settle();
  await vscode.commands.executeCommand("agentCodeWalk.previous");
  await settle();
  assert.equal(
    normalize(vscode.window.activeTextEditor?.document.uri.fsPath ?? ""),
    normalize(path.join(workspaceRoot, "src", "lib.rs")),
    "switching order must keep navigation working",
  );
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

/** Lets the extension host finish the asynchronous work a command scheduled. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}
