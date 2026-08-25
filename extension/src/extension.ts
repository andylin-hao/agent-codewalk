import * as vscode from "vscode";

import { IntegrationInstaller } from "./installer.js";
import { WalkthroughPlayer } from "./player.js";
import { SessionStore } from "./storage.js";
import type { ChangeKind } from "./types.js";
import { WalkthroughViewProvider } from "./webview.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Agent CodeWalk", { log: true });
  const decorations = createDecorations();
  const store = new SessionStore(output);
  const player = new WalkthroughPlayer(store, decorations, output);
  const provider = new WalkthroughViewProvider(context.extensionUri, player);
  const installer = new IntegrationInstaller(context, output);

  context.subscriptions.push(
    output,
    player,
    provider,
    ...Object.values(decorations),
    vscode.window.registerWebviewViewProvider("agentCodeWalk.walkthrough", provider),
    command("agentCodeWalk.openLatest", async () => {
      await vscode.commands.executeCommand("agentCodeWalk.walkthrough.focus");
      await player.openLatest();
    }),
    command("agentCodeWalk.previous", () => player.previous()),
    command("agentCodeWalk.next", () => player.next()),
    command("agentCodeWalk.switchMode", () => player.switchMode()),
    command("agentCodeWalk.delete", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Delete the active Agent CodeWalk session? This cannot be undone.",
        { modal: true },
        "Delete",
      );
      if (choice === "Delete") {
        await player.deleteActive();
      }
    }),
    command("agentCodeWalk.setup", () => {
      return installer.setup();
    }),
    command("agentCodeWalk.diagnose", () => {
      output.info(`Loaded ${String(player.getState().sessions.length)} walkthrough session(s).`);
      return installer.diagnose();
    }),
    command("agentCodeWalk.uninstall", () => installer.uninstall()),
  );
  player.start();
}

function command(identifier: string, callback: () => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(identifier, callback);
}

function createDecorations(): Readonly<Record<ChangeKind, vscode.TextEditorDecorationType>> {
  const common: vscode.DecorationRenderOptions = {
    isWholeLine: true,
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  };
  return {
    add: vscode.window.createTextEditorDecorationType({
      ...common,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
      borderColor: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
      overviewRulerColor: new vscode.ThemeColor("gitDecoration.addedResourceForeground"),
    }),
    modify: vscode.window.createTextEditorDecorationType({
      ...common,
      backgroundColor: new vscode.ThemeColor("diffEditor.modifiedLineBackground"),
      borderColor: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
      overviewRulerColor: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
    }),
    delete: vscode.window.createTextEditorDecorationType({
      ...common,
      backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
      borderColor: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
      overviewRulerColor: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
    }),
    rename: vscode.window.createTextEditorDecorationType({
      ...common,
      backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
      borderColor: new vscode.ThemeColor("gitDecoration.renamedResourceForeground"),
      overviewRulerColor: new vscode.ThemeColor("gitDecoration.renamedResourceForeground"),
    }),
  };
}
