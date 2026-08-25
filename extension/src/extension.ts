import * as vscode from "vscode";

import { StepCodeLensProvider } from "./codelens.js";
import { StepDiffProvider } from "./diff.js";
import { format, messagesFor } from "./i18n.js";
import { IntegrationInstaller, VERSION } from "./installer.js";
import { WalkthroughPlayer } from "./player.js";
import { SessionStore } from "./storage.js";
import type { ChangeKind, ViewState, WalkthroughKind } from "./types.js";
import { WalkthroughViewProvider } from "./webview.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Agent CodeWalk", { log: true });
  const decorations = createDecorations();
  const contextDecoration = createContextDecoration();
  const diffs = new StepDiffProvider();
  const store = new SessionStore(output);
  const player = new WalkthroughPlayer(store, decorations, contextDecoration, diffs, output);
  const provider = new WalkthroughViewProvider(context.extensionUri, player);
  const lenses = new StepCodeLensProvider(player);
  const installer = new IntegrationInstaller(context, output);
  const status = createStatusBarItem();

  context.subscriptions.push(
    output,
    player,
    provider,
    lenses,
    status,
    diffs.register(),
    contextDecoration,
    ...Object.values(decorations),
    vscode.window.registerWebviewViewProvider("agentCodeWalk.walkthrough", provider),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, lenses),
    player.onDidChangeState((state) => {
      updateStatusBar(status, state);
      void vscode.commands.executeCommand(
        "setContext",
        "agentCodeWalk.hasSession",
        state.stepCount > 0,
      );
    }),
    player.onDidPublishSession((session) => {
      void announce(
        session.walkthrough.kind,
        session.walkthrough.title,
        session.walkthrough.steps.length,
      );
    }),
    command("agentCodeWalk.openLatest", async () => {
      await vscode.commands.executeCommand("agentCodeWalk.walkthrough.focus");
      await player.openLatest();
    }),
    command("agentCodeWalk.previous", () => player.previous()),
    command("agentCodeWalk.next", () => player.next()),
    command("agentCodeWalk.switchMode", () => player.switchMode()),
    command("agentCodeWalk.showDiff", () => player.showDiff()),
    commandWithArgument("agentCodeWalk.goToStep", async (stepId) => {
      await player.selectStep(stepId);
    }),
    commandWithArgument("agentCodeWalk.toggleStep", async (stepId) => {
      await player.toggleStep(stepId);
    }),
    command("agentCodeWalk.expandAll", () => player.expandAll()),
    command("agentCodeWalk.collapseAll", () => player.collapseAll()),
    commandWithArgument("agentCodeWalk.showStepDiff", async (stepId) => {
      await player.selectStep(stepId);
      await player.showDiff();
    }),
    command("agentCodeWalk.jumpToStep", () => jumpToStep(player)),
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
    command("agentCodeWalk.setup", () => installer.setup()),
    command("agentCodeWalk.diagnose", async () => {
      output.info(`Extension and companion version: ${VERSION}.`);
      output.info(`Loaded ${String(player.getState().sessions.length)} walkthrough session(s).`);
      await installer.diagnose();
    }),
    command("agentCodeWalk.uninstall", () => installer.uninstall()),
  );
  player.start();
}

interface StepPick extends vscode.QuickPickItem {
  readonly stepId: string;
}

/** Offers every step of the active walkthrough in one searchable list. */
export async function jumpToStep(player: WalkthroughPlayer): Promise<void> {
  const state = player.getState();
  if (state.steps.length === 0) {
    await vscode.window.showInformationMessage(messagesFor(vscode.env.language).noWalkthrough);
    return;
  }
  const picks: StepPick[] = state.steps.map((step) => ({
    label: `${String(step.position)}. ${step.title}`,
    description: `${step.path}:${String(step.startLine)}`,
    ...(step.active ? { detail: "Current step" } : {}),
    stepId: step.id,
  }));
  const picked = await vscode.window.showQuickPick<StepPick>(picks, {
    title: state.title ?? "Agent CodeWalk",
    placeHolder: "Jump to a step",
  });
  if (picked !== undefined) {
    await player.selectStep(picked.stepId);
  }
}

async function announce(
  kind: WalkthroughKind,
  title: string,
  stepCount: number,
): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("agentCodeWalk")
    .get<boolean>("notifyOnPublish", true);
  if (!enabled) {
    return;
  }
  const messages = messagesFor(vscode.env.language);
  const template =
    kind === "explanation" ? messages.explanationPublishedNotice : messages.publishedNotice;
  const choice = await vscode.window.showInformationMessage(
    format(template, title, stepCount),
    messages.openWalkthrough,
  );
  if (choice === messages.openWalkthrough) {
    await vscode.commands.executeCommand("agentCodeWalk.openLatest");
  }
}

function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "agentCodeWalk.jumpToStep";
  item.tooltip = "Jump to an Agent CodeWalk step";
  return item;
}

export function updateStatusBar(item: vscode.StatusBarItem, state: ViewState): void {
  if (state.stepCount === 0) {
    item.hide();
    return;
  }
  item.text = `$(list-ordered) CodeWalk ${String(state.stepNumber)}/${String(state.stepCount)}`;
  item.show();
}

function command(identifier: string, callback: () => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(identifier, callback);
}

/** Registers a command whose only argument is a step identifier, rejecting anything else. */
function commandWithArgument(
  identifier: string,
  callback: (stepId: string) => Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand(identifier, async (stepId: unknown) => {
    if (typeof stepId !== "string" || stepId.length === 0) {
      throw new Error(`${identifier} requires a step identifier`);
    }
    await callback(stepId);
  });
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
    // Nothing changed here. The highlight is neutral so it does not read as a diff,
    // which is also every step of an explanation walkthrough.
    context: vscode.window.createTextEditorDecorationType({
      ...common,
      backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
      borderColor: new vscode.ThemeColor("editorInfo.foreground"),
      overviewRulerColor: new vscode.ThemeColor("editorInfo.foreground"),
    }),
  };
}

/**
 * Marks the other steps of the same file. It is deliberately quieter than the active
 * decoration so that the current step stays the only thing the eye lands on.
 */
function createContextDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: "0 0 0 2px",
    borderStyle: "dotted",
    borderColor: new vscode.ThemeColor("editorLineNumber.foreground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    overviewRulerColor: new vscode.ThemeColor("editorLineNumber.foreground"),
  });
}
