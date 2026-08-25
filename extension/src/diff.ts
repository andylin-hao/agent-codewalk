import * as vscode from "vscode";

import type { WalkthroughStep } from "./types.js";

/** URI scheme used for the read-only snippets shown in a step diff. */
export const DIFF_SCHEME = "agent-codewalk";

/**
 * Serves the two snippets of a per-step diff.
 *
 * The companion records only the lines a step replaced, never whole files, so the diff
 * compares the recorded baseline excerpt with the code the step currently highlights
 * rather than opening two full documents.
 */
export class StepDiffProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private registration: vscode.Disposable | undefined;

  public readonly onDidChange = this.changeEmitter.event;

  public register(): vscode.Disposable {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, this);
    return this;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  /**
   * Opens the diff for one step.
   *
   * @param step The step to explain.
   * @param currentText The text the step highlights right now.
   * @returns Whether a diff was available.
   */
  public async show(step: WalkthroughStep, currentText: string): Promise<boolean> {
    if (step.previousText === undefined) {
      return false;
    }
    const before = this.publish(step, "before", step.previousText);
    const after = this.publish(step, "after", currentText);
    await vscode.commands.executeCommand(
      "vscode.diff",
      before,
      after,
      `${step.title} — before ↔ after`,
      { preview: true },
    );
    return true;
  }

  public dispose(): void {
    this.contents.clear();
    this.changeEmitter.dispose();
    this.registration?.dispose();
    this.registration = undefined;
  }

  private publish(step: WalkthroughStep, side: "before" | "after", content: string): vscode.Uri {
    const extension = suffix(step.path);
    const uri = vscode.Uri.parse(
      `${DIFF_SCHEME}:/${side}/${encodeURIComponent(step.id)}/${basename(step.path)}${extension}`,
    );
    this.contents.set(uri.toString(), content);
    this.changeEmitter.fire(uri);
    return uri;
  }
}

function basename(value: string): string {
  const name = value.split("/").at(-1) ?? value;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/** Keeps the original extension so the diff editor applies the right syntax highlighting. */
function suffix(value: string): string {
  const name = value.split("/").at(-1) ?? value;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}
