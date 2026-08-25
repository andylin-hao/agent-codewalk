import * as vscode from "vscode";

import type { WalkthroughPlayer } from "./player.js";

/**
 * Puts the walkthrough next to the code.
 *
 * The sidebar explains one step at a time; these lenses show a reader who is already
 * looking at a file which parts of it the agent explained, and let them jump straight in.
 */
export class StepCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  public constructor(private readonly player: WalkthroughPlayer) {
    this.subscription = player.onDidChangeState(() => this.changeEmitter.fire());
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== "file") {
      return [];
    }
    const located = this.player.locateSteps(document.uri.fsPath, document.getText());
    const lenses: vscode.CodeLens[] = [];
    for (const entry of located) {
      const range = new vscode.Range(entry.startLine - 1, 0, entry.startLine - 1, 0);
      const marker = entry.active ? "●" : "○";
      lenses.push(
        new vscode.CodeLens(range, {
          command: "agentCodeWalk.goToStep",
          title: `${marker} Step ${String(entry.position)} · ${entry.step.title}`,
          tooltip: entry.step.explanation,
          arguments: [entry.step.id],
        }),
      );
      if (entry.step.previousText !== undefined) {
        lenses.push(
          new vscode.CodeLens(range, {
            command: "agentCodeWalk.showStepDiff",
            title: "Compare with before",
            arguments: [entry.step.id],
          }),
        );
      }
    }
    return lenses;
  }

  public dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}
