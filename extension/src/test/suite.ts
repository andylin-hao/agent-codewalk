import assert from "node:assert/strict";

import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("agent-codewalk.agent-codewalk");
  assert.ok(extension, "Agent CodeWalk development extension must be discoverable");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "agentCodeWalk.openLatest",
    "agentCodeWalk.next",
    "agentCodeWalk.previous",
    "agentCodeWalk.setup",
    "agentCodeWalk.uninstall",
  ]) {
    assert.ok(commands.includes(command), `Expected command to be registered: ${command}`);
  }
}

