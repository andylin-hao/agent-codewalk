import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { type Messages, messagesFor } from "./i18n.js";
import type { ExplanationMode, ViewState } from "./types.js";
import type { WalkthroughPlayer } from "./player.js";

type ViewMessage =
  | { readonly type: "next" }
  | { readonly type: "previous" }
  | { readonly type: "refresh" }
  | { readonly type: "setup" }
  | { readonly type: "delete" }
  | { readonly type: "showDiff" }
  | { readonly type: "select"; readonly sessionId: string }
  | { readonly type: "selectStep"; readonly stepId: string }
  | { readonly type: "setMode"; readonly mode: ExplanationMode };

export class WalkthroughViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly stateSubscription: vscode.Disposable;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly player: WalkthroughPlayer,
  ) {
    this.stateSubscription = player.onDidChangeState((state) => {
      this.update(state);
    });
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    view.webview.html = html(messagesFor(vscode.env.language));
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
      case "refresh":
        await this.player.refresh();
        break;
      case "select":
        await this.player.select(message.sessionId);
        break;
      case "selectStep":
        await this.player.selectStep(message.stepId);
        break;
      case "setMode":
        await this.player.setMode(message.mode);
        break;
      case "showDiff":
        await this.player.showDiff();
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

export function parseMessage(value: unknown): ViewMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("Invalid Agent CodeWalk webview message");
  }
  const type = value.type;
  if (
    type === "next" ||
    type === "previous" ||
    type === "refresh" ||
    type === "setup" ||
    type === "delete" ||
    type === "showDiff"
  ) {
    return { type };
  }
  if (type === "select" && hasText(value, "sessionId")) {
    return { type, sessionId: value.sessionId };
  }
  if (type === "selectStep" && hasText(value, "stepId")) {
    return { type, stepId: value.stepId };
  }
  if (type === "setMode" && "mode" in value && (value.mode === "file" || value.mode === "flow")) {
    return { type, mode: value.mode };
  }
  throw new Error("Unsupported Agent CodeWalk webview message");
}

function hasText<Key extends string>(
  value: object,
  key: Key,
): value is Record<Key, string> & object {
  return (
    key in value &&
    typeof (value as Record<string, unknown>)[key] === "string" &&
    ((value as Record<string, string>)[key] ?? "").length > 0
  );
}

/**
 * Serializes a value for use inside a `<script>` block.
 *
 * `JSON.stringify` alone is not enough: it leaves `</script>` intact, which would end the
 * block early and let the remaining text be parsed as markup.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028");
}

/** Escapes text that is interpolated into markup rather than set through the DOM. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function nonceValue(): string {
  return randomBytes(24).toString("base64url");
}

export function html(messages: Messages = messagesFor("en")): string {
  const nonce = nonceValue();
  const csp = [
    "default-src 'none'",
    "style-src 'nonce-" + nonce + "'",
    "script-src 'nonce-" + nonce + "'",
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style nonce="${nonce}">${styles()}</style>
</head>
<body>
  <div id="empty" class="onboarding">
    <h2>${escapeHtml(messages.emptyTitle)}</h2>
    <p class="muted">${escapeHtml(messages.emptyLead)}</p>
    <ol class="steps-help">
      ${messages.emptySteps.map((entry) => `<li>${entry}</li>`).join("\n      ")}
    </ol>
    <button id="setup-primary" class="primary" type="button">${escapeHtml(messages.setupPrimary)}</button>
  </div>

  <main id="content" hidden>
    <header class="header">
      <div class="header-row">
        <h1 id="title"></h1>
        <span id="kind-pill" class="pill" hidden></span>
        <button id="refresh" class="icon" type="button" title="${escapeHtml(messages.reload)}" aria-label="${escapeHtml(messages.reload)}">&#x21bb;</button>
      </div>
      <p id="summary" class="muted"></p>
      <div class="progress" role="group" aria-label="${escapeHtml(messages.progressLabel)}">
        <div class="track"><div id="bar" class="bar"></div></div>
        <span id="progress-label" class="progress-label"></span>
      </div>
      <div class="controls">
        <button id="previous" type="button"><span aria-hidden="true">&#x2190;</span> ${escapeHtml(messages.previous)}</button>
        <button id="next" class="primary" type="button">${escapeHtml(messages.next)} <span aria-hidden="true">&#x2192;</span></button>
      </div>
      <div class="segmented" role="radiogroup" aria-label="${escapeHtml(messages.allSteps)}">
        <button id="mode-file" type="button" role="radio">${escapeHtml(messages.orderByFile)}</button>
        <button id="mode-flow" type="button" role="radio">${escapeHtml(messages.orderByFlow)}</button>
      </div>
      <p class="hint muted">${escapeHtml(messages.keyboardHint)}</p>
    </header>

    <section class="card" aria-labelledby="step-title">
      <div class="card-top">
        <span id="kind" class="badge"></span>
        <span id="position" class="muted"></span>
      </div>
      <h2 id="step-title"></h2>
      <button id="path" class="path" type="button" title="Open this location"></button>
      <p id="explanation"></p>
      <div class="card-actions">
        <button id="diff" type="button" hidden>${escapeHtml(messages.compare)}</button>
      </div>
      <div id="flow-after" class="flow-after muted" hidden></div>
    </section>

    <div id="notices"></div>

    <section class="list" aria-label="${escapeHtml(messages.allSteps)}">
      <h3 class="section-title">${escapeHtml(messages.allSteps)}</h3>
      <div id="steps"></div>
    </section>

    <footer class="footer">
      <label class="field" for="sessions">${escapeHtml(messages.sessionLabel)}</label>
      <select id="sessions" aria-label="${escapeHtml(messages.sessionLabel)}"></select>
      <div class="footer-actions">
        <button id="setup" type="button">${escapeHtml(messages.integrations)}</button>
        <button id="delete" type="button">${escapeHtml(messages.delete)}</button>
      </div>
    </footer>
  </main>
  <script nonce="${nonce}">const MESSAGES = ${embedJson(messages)};
${script()}</script>
</body>
</html>`;
}

function styles(): string {
  return `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0 12px 16px;
      color: var(--vscode-foreground);
      font: var(--vscode-font-size)/1.5 var(--vscode-font-family);
    }
    h1 { font-size: 1.08em; margin: 0; font-weight: 600; }
    h2 { font-size: 1em; margin: 0 0 4px; font-weight: 600; }
    h3 { font-size: .85em; margin: 0; font-weight: 600; }
    p { margin: 0 0 8px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .header { position: sticky; top: 0; z-index: 2; padding-top: 12px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    .header-row { display: flex; align-items: flex-start; gap: 8px; }
    .header-row h1 { flex: 1; overflow-wrap: anywhere; }
    button {
      font: inherit;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-contrastBorder, transparent);
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button:disabled { opacity: .4; cursor: default; }
    button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button.icon { padding: 2px 7px; line-height: 1.4; }
    .progress { display: flex; align-items: center; gap: 8px; margin: 10px 0 8px; }
    .track { flex: 1; height: 4px; border-radius: 2px; background: var(--vscode-progressBar-background, var(--vscode-editorWidget-border)); opacity: .35; }
    .bar { height: 100%; width: 0; border-radius: 2px; background: var(--vscode-progressBar-background, var(--vscode-textLink-foreground)); opacity: 1; transition: width .15s ease-out; }
    .progress-label { font-size: .82em; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
    .controls { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 8px 0 4px; }
    .segmented button { border-radius: 0; }
    .segmented button:first-child { border-radius: 4px 0 0 4px; }
    .segmented button:last-child { border-radius: 0 4px 4px 0; border-left-width: 0; }
    .segmented button[aria-checked="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .hint { font-size: .78em; margin: 2px 0 10px; }
    .card {
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--vscode-editorWidget-background, transparent);
      margin-bottom: 12px;
    }
    .card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .badge { font-size: .72em; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 10px; border: 1px solid currentColor; }
    .badge.context { color: var(--vscode-editorInfo-foreground, var(--vscode-descriptionForeground)); }
    .pill { flex: none; font-size: .7em; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 10px; color: var(--vscode-editorInfo-foreground, var(--vscode-descriptionForeground)); border: 1px solid currentColor; }
    .badge.add { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .badge.modify { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
    .badge.delete { color: var(--vscode-gitDecoration-deletedResourceForeground); }
    .badge.rename { color: var(--vscode-gitDecoration-renamedResourceForeground); }
    .path {
      display: block; width: 100%; text-align: left; padding: 0; margin: 0 0 8px;
      border: 0; background: none; color: var(--vscode-textLink-foreground);
      font-family: var(--vscode-editor-font-family); font-size: .85em; overflow-wrap: anywhere;
    }
    .path:hover { text-decoration: underline; background: none; }
    #explanation { white-space: pre-wrap; margin: 0; }
    .card-actions { margin-top: 10px; display: flex; gap: 6px; }
    .card-actions:empty { margin: 0; }
    .flow-after { font-size: .8em; margin-top: 8px; }
    .section-title { margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .05em; font-size: .74em; color: var(--vscode-descriptionForeground); }
    .group-path { font-family: var(--vscode-editor-font-family); font-size: .78em; color: var(--vscode-descriptionForeground); margin: 8px 0 3px; overflow-wrap: anywhere; }
    .row {
      display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: baseline;
      width: 100%; text-align: left; border: 0; border-radius: 4px; background: none;
      padding: 5px 8px; margin-bottom: 1px;
    }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row[aria-current="true"] { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .row .index { font-variant-numeric: tabular-nums; font-size: .78em; opacity: .7; }
    .row .label { overflow-wrap: anywhere; }
    .row .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; background: currentColor; }
    .row .after { display: block; font-size: .76em; opacity: .75; }
    .notice { border-left: 3px solid var(--vscode-editorWarning-foreground); padding: 6px 0 6px 8px; margin: 8px 0; font-size: .86em; }
    .notice.error { border-left-color: var(--vscode-editorError-foreground); }
    .notice ul { margin: 4px 0 0; padding-left: 16px; }
    .notice code { font-family: var(--vscode-editor-font-family); }
    .onboarding { padding-top: 16px; }
    .steps-help { padding-left: 18px; margin: 10px 0 14px; }
    .steps-help li { margin-bottom: 5px; }
    .footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border)); }
    .field { display: block; font-size: .74em; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    select {
      width: 100%; font: inherit; padding: 4px 6px; border-radius: 4px;
      color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border, transparent);
    }
    .footer-actions { display: flex; gap: 6px; margin-top: 8px; }
    .footer-actions button { flex: 1; }
  `;
}

function script(): string {
  return `
    const vscodeApi = acquireVsCodeApi();
    const byId = (id) => document.getElementById(id);
    let state;

    const send = (type, extra) => vscodeApi.postMessage(Object.assign({ type: type }, extra || {}));
    byId('next').addEventListener('click', () => send('next'));
    byId('previous').addEventListener('click', () => send('previous'));
    byId('refresh').addEventListener('click', () => send('refresh'));
    byId('setup').addEventListener('click', () => send('setup'));
    byId('setup-primary').addEventListener('click', () => send('setup'));
    byId('delete').addEventListener('click', () => send('delete'));
    byId('diff').addEventListener('click', () => send('showDiff'));
    byId('mode-file').addEventListener('click', () => send('setMode', { mode: 'file' }));
    byId('mode-flow').addEventListener('click', () => send('setMode', { mode: 'flow' }));
    byId('path').addEventListener('click', () => {
      if (state && state.step) send('selectStep', { stepId: state.step.id });
    });
    byId('sessions').addEventListener('change', (event) => {
      send('select', { sessionId: event.target.value });
    });

    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'state') return;
      state = event.data.state;
      render();
    });

    function text(id, value) { byId(id).textContent = value === undefined || value === null ? '' : value; }
    function format(template) {
      const values = Array.prototype.slice.call(arguments, 1);
      return template.replace(/{(\\d+)}/g, (match, index) => {
        const value = values[Number(index)];
        return value === undefined ? match : String(value);
      });
    }

    function render() {
      const hasStep = Boolean(state.step);
      byId('empty').hidden = hasStep;
      byId('content').hidden = !hasStep;
      renderSessions();
      renderNotices();
      if (!hasStep) return;

      text('title', state.title);
      text('summary', state.summary);
      text('step-title', state.step.title);
      text('explanation', state.step.explanation);
      text('path', state.step.path + ':' + state.step.anchor.startLine + '-' + state.step.anchor.endLine);
      text('kind', MESSAGES.kinds[state.step.changeKind] || state.step.changeKind);
      byId('kind').className = 'badge ' + state.step.changeKind;
      const isExplanation = state.kind === 'explanation';
      byId('kind-pill').hidden = !isExplanation;
      text('kind-pill', MESSAGES.explanationLabel);
      text('position', format(MESSAGES.stepCounter, state.stepNumber, state.stepCount));
      text('progress-label', state.stepNumber + '/' + state.stepCount);
      byId('bar').style.width = (state.stepCount === 0 ? 0 : (state.stepNumber / state.stepCount) * 100) + '%';
      byId('previous').disabled = state.stepNumber <= 1;
      byId('next').disabled = state.stepNumber >= state.stepCount;
      byId('diff').hidden = !state.canShowDiff;

      const fileMode = state.mode === 'file';
      byId('mode-file').setAttribute('aria-checked', String(fileMode));
      byId('mode-flow').setAttribute('aria-checked', String(!fileMode));

      renderFlowAfter();
      renderSteps();
    }

    function renderSessions() {
      const select = byId('sessions');
      select.replaceChildren.apply(select, state.sessions.map((session) => {
        const option = document.createElement('option');
        option.value = session.id;
        const label = session.kind === 'explanation' ? MESSAGES.explanationLabel : MESSAGES.changeLabel;
        option.textContent = label + '  ·  ' + session.title + '  ·  ' + session.stepCount + ' ' + MESSAGES.stepUnit;
        option.selected = session.id === state.activeSessionId;
        return option;
      }));
      byId('delete').disabled = !state.activeSessionId;
    }

    function renderFlowAfter() {
      const container = byId('flow-after');
      const predecessors = state.step.flowAfter || [];
      const shouldShow = state.mode === 'flow' && predecessors.length > 0;
      container.hidden = !shouldShow;
      if (!shouldShow) return;
      const titles = predecessors.map((id) => {
        const match = state.steps.filter((candidate) => candidate.id === id)[0];
        return match ? match.title : id;
      });
      container.textContent = MESSAGES.runsAfter + titles.join(', ');
    }

    function stepRow(step) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      row.setAttribute('aria-current', String(Boolean(step.active)));
      const index = document.createElement('span');
      index.className = 'index';
      index.textContent = String(step.position);
      const label = document.createElement('span');
      label.className = 'label';
      const dot = document.createElement('span');
      dot.className = 'dot badge ' + step.changeKind;
      label.appendChild(dot);
      label.appendChild(document.createTextNode(step.title));
      if (state.mode === 'flow' && step.flowAfter && step.flowAfter.length > 0) {
        const after = document.createElement('span');
        after.className = 'after';
        after.textContent = step.path;
        label.appendChild(after);
      }
      row.appendChild(index);
      row.appendChild(label);
      row.addEventListener('click', () => send('selectStep', { stepId: step.id }));
      return row;
    }

    function renderSteps() {
      const container = byId('steps');
      const children = [];
      if (state.mode === 'file') {
        state.groups.forEach((group) => {
          const heading = document.createElement('div');
          heading.className = 'group-path';
          heading.textContent = group.path;
          children.push(heading);
          group.steps.forEach((step) => children.push(stepRow(step)));
        });
      } else {
        state.steps.forEach((step) => children.push(stepRow(step)));
      }
      container.replaceChildren.apply(container, children);
    }

    function notice(message, isError, items) {
      const box = document.createElement('div');
      box.className = isError ? 'notice error' : 'notice';
      box.appendChild(document.createTextNode(message));
      if (items && items.length > 0) {
        const list = document.createElement('ul');
        items.forEach((item) => {
          const entry = document.createElement('li');
          entry.textContent = item;
          list.appendChild(entry);
        });
        box.appendChild(list);
      }
      return box;
    }

    function renderNotices() {
      const container = byId('notices');
      const boxes = [];
      if (state.error) boxes.push(notice(state.error, true));
      if (state.stale) boxes.push(notice(MESSAGES.staleNotice, true));
      if (state.relocated) boxes.push(notice(MESSAGES.relocatedNotice, false));
      if (state.degradedBaseline) boxes.push(notice(MESSAGES.degradedNotice, false));
      if (state.uncoveredHunks && state.uncoveredHunks.length > 0) {
        boxes.push(notice(MESSAGES.uncoveredNotice, false, state.uncoveredHunks.map(
          (hunk) => hunk.path + ':' + hunk.startLine + '-' + hunk.endLine
        )));
      }
      if (state.excludedChanges && state.excludedChanges.length > 0) {
        boxes.push(notice(MESSAGES.excludedNotice, false, state.excludedChanges.map(
          (change) => change.path + ' — ' + change.reason
        )));
      }
      container.replaceChildren.apply(container, boxes);
    }
  `;
}
