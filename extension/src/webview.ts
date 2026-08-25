import * as vscode from "vscode";

import type { ViewState } from "./types.js";
import type { WalkthroughPlayer } from "./player.js";

type ViewMessage =
  | { readonly type: "next" }
  | { readonly type: "previous" }
  | { readonly type: "switchMode" }
  | { readonly type: "refresh" }
  | { readonly type: "setup" }
  | { readonly type: "delete" }
  | { readonly type: "select"; readonly sessionId: string };

export class WalkthroughViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly stateSubscription: vscode.Disposable;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly player: WalkthroughPlayer,
  ) {
    this.stateSubscription = player.onDidChangeState((state) => this.update(state));
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = html();
    view.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message));
    this.update(this.player.getState());
  }

  public dispose(): void {
    this.stateSubscription.dispose();
  }

  private update(state: ViewState): void {
    void this.view?.webview.postMessage({ type: "state", state });
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseMessage(value);
    switch (message.type) {
      case "next":
        await this.player.next();
        break;
      case "previous":
        await this.player.previous();
        break;
      case "switchMode":
        await this.player.switchMode();
        break;
      case "refresh":
        await this.player.refresh();
        break;
      case "select":
        await this.player.select(message.sessionId);
        break;
      case "setup":
        await vscode.commands.executeCommand("agentCodeWalk.setup");
        break;
      case "delete":
        await vscode.commands.executeCommand("agentCodeWalk.delete");
        break;
    }
  }
}

function parseMessage(value: unknown): ViewMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("Invalid Agent CodeWalk webview message");
  }
  const type = value.type;
  if (
    type === "next" ||
    type === "previous" ||
    type === "switchMode" ||
    type === "refresh" ||
    type === "setup" ||
    type === "delete"
  ) {
    return { type };
  }
  if (
    type === "select" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0
  ) {
    return { type, sessionId: value.sessionId };
  }
  throw new Error("Unsupported Agent CodeWalk webview message");
}

function html(): string {
  const nonce = nonceValue();
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { padding: 12px; color: var(--vscode-foreground); font: var(--vscode-font-size)/1.45 var(--vscode-font-family); }
    button, select { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, transparent); padding: 5px 8px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .5; }
    select { width: 100%; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); margin-bottom: 12px; }
    .toolbar { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0; }
    .progress { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .path { color: var(--vscode-textLink-foreground); overflow-wrap: anywhere; }
    .notice { border-left: 3px solid var(--vscode-editorWarning-foreground); padding-left: 8px; margin: 10px 0; }
    .error { border-left-color: var(--vscode-editorError-foreground); }
    .empty { color: var(--vscode-descriptionForeground); }
    #explanation { white-space: pre-wrap; }
    .footer { display: flex; gap: 6px; margin-top: 14px; }
  </style>
</head>
<body>
  <select id="sessions" aria-label="Walkthrough session"></select>
  <div id="empty" class="empty">No walkthroughs yet. Set up an Agent integration, then ask it to modify code.</div>
  <main id="content" hidden>
    <h2 id="title"></h2>
    <p id="summary"></p>
    <div id="baseline" class="notice" hidden>This session used a degraded baseline; its change scope may be incomplete.</div>
    <div id="error" class="notice error" hidden></div>
    <div class="toolbar">
      <button id="previous" type="button">Previous</button>
      <button id="next" type="button">Next</button>
      <button id="mode" type="button"></button>
      <button id="refresh" type="button">Refresh</button>
    </div>
    <p id="progress" class="progress"></p>
    <h3 id="step-title"></h3>
    <p id="path" class="path"></p>
    <p id="explanation"></p>
    <div id="relocated" class="notice" hidden>The highlighted block moved; Agent CodeWalk found one unique match.</div>
    <div id="excluded" class="notice" hidden></div>
  </main>
  <div class="footer">
    <button id="setup" type="button">Setup integrations</button>
    <button id="delete" type="button">Delete</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const byId = (id) => document.getElementById(id);
    let state;
    const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
    byId('next').addEventListener('click', () => send('next'));
    byId('previous').addEventListener('click', () => send('previous'));
    byId('mode').addEventListener('click', () => send('switchMode'));
    byId('refresh').addEventListener('click', () => send('refresh'));
    byId('setup').addEventListener('click', () => send('setup'));
    byId('delete').addEventListener('click', () => send('delete'));
    byId('sessions').addEventListener('change', (event) => send('select', { sessionId: event.target.value }));
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'state') return;
      state = event.data.state;
      render();
    });
    function text(id, value) { byId(id).textContent = value ?? ''; }
    function render() {
      const select = byId('sessions');
      select.replaceChildren(...state.sessions.map((session) => {
        const option = document.createElement('option');
        option.value = session.id;
        option.textContent = session.title;
        option.selected = session.id === state.activeSessionId;
        return option;
      }));
      const hasStep = Boolean(state.step);
      byId('empty').hidden = hasStep;
      byId('content').hidden = !hasStep;
      byId('delete').disabled = !state.activeSessionId;
      if (!hasStep) return;
      text('title', state.title);
      text('summary', state.summary);
      text('step-title', state.step.title);
      text('path', state.step.path + ':' + state.step.anchor.startLine + '-' + state.step.anchor.endLine);
      text('explanation', state.step.explanation);
      text('progress', 'Step ' + state.stepNumber + ' of ' + state.stepCount + ' · ' + state.step.changeKind);
      text('mode', state.mode === 'file' ? 'Order: by file' : 'Order: execution flow');
      byId('previous').disabled = state.stepNumber <= 1;
      byId('next').disabled = state.stepNumber >= state.stepCount;
      byId('baseline').hidden = !state.degradedBaseline;
      byId('relocated').hidden = !state.relocated;
      byId('error').hidden = !state.error;
      text('error', state.error);
      byId('excluded').hidden = state.excludedChanges.length === 0;
      text('excluded', state.excludedChanges.map((item) => item.path + ': ' + item.reason).join('\n'));
    }
  </script>
</body>
</html>`;
}

function nonceValue(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 32; index += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
}
