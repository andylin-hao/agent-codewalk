import { Script } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { messagesFor } from "./i18n.js";
import type { WalkthroughPlayer } from "./player.js";
import type { ViewState } from "./types.js";
import { WalkthroughViewProvider, html, nonceValue, parseMessage } from "./webview.js";
import { mockState, resetVscodeMock } from "./test/vscode-mock.js";

describe("parseMessage", () => {
  it.each([["next"], ["previous"], ["refresh"], ["setup"], ["delete"], ["showDiff"]])(
    "accepts the %s command",
    (type) => {
      expect(parseMessage({ type })).toEqual({ type });
    },
  );

  it("accepts a session selection", () => {
    expect(parseMessage({ type: "select", sessionId: "abc" })).toEqual({
      type: "select",
      sessionId: "abc",
    });
  });

  it("accepts a step selection", () => {
    expect(parseMessage({ type: "selectStep", stepId: "step-1" })).toEqual({
      type: "selectStep",
      stepId: "step-1",
    });
  });

  it("accepts an activation", () => {
    expect(parseMessage({ type: "activateStep", stepId: "step-1" })).toEqual({
      type: "activateStep",
      stepId: "step-1",
    });
  });

  it.each([["file"], ["graph"]])("accepts the %s view", (mode) => {
    expect(parseMessage({ type: "setMode", mode })).toEqual({ type: "setMode", mode });
  });

  it.each([
    ["a string", "next"],
    ["null", null],
    ["an array", ["next"]],
    ["an object without a type", {}],
  ])("rejects %s", (_name, value) => {
    expect(() => parseMessage(value)).toThrow(/Invalid Agent CodeWalk webview message/u);
  });

  it.each([
    ["an unknown command", { type: "explode" }],
    ["a selection without an identifier", { type: "select" }],
    ["a selection with an empty identifier", { type: "select", sessionId: "" }],
    ["a step selection with a numeric identifier", { type: "selectStep", stepId: 7 }],
    ["an unsupported view", { type: "setMode", mode: "random" }],
    ["the retired flow view", { type: "setMode", mode: "flow" }],
    ["a toggle without an identifier", { type: "toggleStep" }],
  ])("rejects %s", (_name, value) => {
    expect(() => parseMessage(value)).toThrow(/Unsupported Agent CodeWalk webview message/u);
  });
});

describe("nonceValue", () => {
  it("produces a fresh unpredictable value each time", () => {
    const values = new Set(Array.from({ length: 50 }, () => nonceValue()));
    expect(values.size).toBe(50);
    for (const value of values) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    }
  });
});

interface FakeView {
  readonly posted: unknown[];
  readonly received: ((message: unknown) => void)[];
  html: string;
  options: unknown;
  readonly view: vscode.WebviewView;
}

function createFakeView(): FakeView {
  const posted: unknown[] = [];
  const received: ((message: unknown) => void)[] = [];
  const view = {
    webview: {
      set options(value: unknown) {
        fake.options = value;
      },
      set html(value: string) {
        fake.html = value;
      },
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        received.push(listener);
        return { dispose: () => undefined };
      },
      postMessage: (message: unknown) => {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
  };
  const fake: FakeView = {
    posted,
    received,
    html: "",
    options: undefined,
    view: view as unknown as vscode.WebviewView,
  };
  return fake;
}

/** Records the navigation a webview message triggers. */
function createPlayerStub(): { player: WalkthroughPlayer; calls: string[] } {
  const calls: string[] = [];
  const emitter = new vscode.EventEmitter<ViewState>();
  const player = {
    onDidChangeState: emitter.event,
    getState: () => ({ stepCount: 0, mode: "file" }) as ViewState,
    next: () => record("next"),
    previous: () => record("previous"),
    refresh: () => record("refresh"),
    select: (id: string) => record(`select:${id}`),
    selectStep: (id: string) => record(`selectStep:${id}`),
    setMode: (mode: string) => record(`setMode:${mode}`),
    showDiff: () => record("showDiff"),
  } as unknown as WalkthroughPlayer;
  function record(value: string): Promise<void> {
    calls.push(value);
    return Promise.resolve();
  }
  return { player, calls };
}

describe("WalkthroughViewProvider", () => {
  beforeEach(() => {
    resetVscodeMock();
  });

  it("renders the page and sends the current state on first resolve", () => {
    const { player } = createPlayerStub();
    const provider = new WalkthroughViewProvider(vscode.Uri.file("/extension"), player);
    const fake = createFakeView();

    provider.resolveWebviewView(fake.view);

    expect(fake.html).toContain("Agent CodeWalk turns an agent's change or explanation");
    expect(fake.options).toMatchObject({ enableScripts: true });
    expect(fake.posted).toHaveLength(1);
    provider.dispose();
  });

  it.each([
    [{ type: "next" }, "next"],
    [{ type: "previous" }, "previous"],
    [{ type: "refresh" }, "refresh"],
    [{ type: "showDiff" }, "showDiff"],
    [{ type: "select", sessionId: "s1" }, "select:s1"],
    [{ type: "selectStep", stepId: "step" }, "selectStep:step"],
    [{ type: "setMode", mode: "graph" }, "setMode:graph"],
  ])("routes %j to the player", async (message, expected) => {
    const { player, calls } = createPlayerStub();
    const provider = new WalkthroughViewProvider(vscode.Uri.file("/extension"), player);
    const fake = createFakeView();
    provider.resolveWebviewView(fake.view);

    fake.received[0]?.(message);
    await vi.waitFor(() => {
      expect(calls).toEqual([expected]);
    });
    provider.dispose();
  });

  it.each([
    [{ type: "setup" }, "agentCodeWalk.setup"],
    [{ type: "delete" }, "agentCodeWalk.delete"],
  ])("forwards %j to its command", async (message, expected) => {
    const { player } = createPlayerStub();
    const provider = new WalkthroughViewProvider(vscode.Uri.file("/extension"), player);
    const fake = createFakeView();
    provider.resolveWebviewView(fake.view);

    fake.received[0]?.(message);
    await vi.waitFor(() => {
      expect(mockState.executedCommands.map((entry) => entry.command)).toContain(expected);
    });
    provider.dispose();
  });

  it("stops listening for state once disposed", () => {
    const { player } = createPlayerStub();
    const provider = new WalkthroughViewProvider(vscode.Uri.file("/extension"), player);
    const fake = createFakeView();
    provider.resolveWebviewView(fake.view);
    provider.dispose();
    expect(fake.posted).toHaveLength(1);
  });
});

describe("html", () => {
  it("locks the page down to its own nonce", () => {
    const page = html();
    const nonce = /<style nonce="([^"]+)">/u.exec(page)?.[1];
    expect(nonce).toBeDefined();
    expect(page).toContain(`script-src 'nonce-${String(nonce)}'`);
    expect(page).toContain("default-src 'none'");
    expect(page).not.toContain("unsafe-inline");
  });

  it("renders every region the state update addresses", () => {
    const page = html();
    for (const id of [
      "empty",
      "content",
      "title",
      "summary",
      "bar",
      "progress-label",
      "previous",
      "next",
      "mode-file",
      "mode-graph",
      "kind",
      "step-title",
      "path",
      "explanation",
      "diff",
      "flow-after",
      "notices",
      "steps",
      "sessions",
    ]) {
      expect(page, `missing element: ${id}`).toContain(`id="${id}"`);
    }
  });

  it("gives a first-time reader something to do", () => {
    const page = html();
    expect(page).toContain("Set up agent integrations");
    expect(page).toContain("Alt+] reads on, opening a step to show its detail.");
  });

  it("renders in the editor's language", () => {
    const page = html(messagesFor("zh-cn"));
    expect(page).toContain("配置 Agent 集成");
    expect(page).toContain("流程图");
    expect(page).toContain('"stepCounter":"第 {0} 步，共 {1} 步"');
  });

  it("escapes a message rather than letting it close a tag", () => {
    const page = html({ ...messagesFor("en"), next: '"><script>alert(1)</script>' });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("embeds a client script that parses", () => {
    const page = html();
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/u.exec(page)?.[1];
    expect(script).toBeDefined();
    // Compiling without running proves the hand-written client script is valid
    // JavaScript, which nothing else in this suite would catch.
    expect(() => new Script(script ?? "")).not.toThrow();
  });

  it("offers the graph as a third view", () => {
    const page = html();
    expect(page).toContain('id="mode-graph"');
    expect(page).toContain("send('setMode', { mode: 'graph' })");
    expect(page).toContain("state.graph.nodes");
  });

  it("shows the graph instead of the flat list, never both", () => {
    const page = html();
    expect(page).toContain("byId('graph').hidden = !isGraph");
    expect(page).toContain("byId('steps').hidden = isGraph");
  });

  it("puts the current step above the walkthrough summary", () => {
    // The block being read is what the reader came for; the overview is reference.
    const page = html();
    expect(page.indexOf('id="step-title"')).toBeLessThan(page.indexOf('id="overview"'));
    expect(page.indexOf('id="overview"')).toBeLessThan(page.indexOf('id="summary"'));
  });

  it("leaves the overview collapsed until it is clicked", () => {
    const page = html();
    expect(page).toMatch(/<details id="overview"[^>]*>/u);
    expect(page).not.toMatch(/<details id="overview"[^>]*\sopen/u);
  });

  it("offers the same disclosure control in both views", () => {
    // The by-file list hides a collapsed subtree too, so it needs a way to open one.
    const page = html();
    expect(page).toContain("function twistyFor(node)");
    expect(page).toContain("wrapper.appendChild(twistyFor(step))");
    expect(page).toContain("const twisty = twistyFor(node)");
  });

  it("shows one chevron that turns, rather than two glyphs that swap", () => {
    const page = html();
    expect(page).toContain("chevron.className = 'chevron'");
    // The rotation is driven by the accessible state, so the two cannot disagree.
    expect(page).toContain('.twisty[aria-expanded="true"] .chevron { transform: rotate(90deg); }');
    expect(page).toContain("twisty.setAttribute('aria-expanded'");
  });

  it("leaves the arrow out of a step that has no detail", () => {
    const page = html();
    expect(page).toContain(".twisty:disabled { opacity: 0; cursor: default; }");
  });

  it("sends a click on a row as an activation, in both views", () => {
    const page = html();
    expect(page).toContain("send('activateStep', { stepId: step.id })");
    expect(page).toContain("send('activateStep', { stepId: node.id })");
  });

  it("keeps the twisty from also selecting the row beneath it", () => {
    const page = html();
    expect(page).toContain("event.stopPropagation()");
  });

  it("warns about a stale companion and names both versions", () => {
    const page = html();
    expect(page).toContain("state.staleCompanion");
    expect(page).toContain("MESSAGES.staleCompanionNotice");
    expect(page).toContain("const EXTENSION_VERSION =");
  });

  it("carries a pill that marks an explanation", () => {
    const page = html();
    expect(page).toContain('id="kind-pill"');
    expect(page).toContain("state.kind === 'explanation'");
    expect(page).toContain("MESSAGES.explanationLabel");
  });

  it("labels a step badge from the message table rather than the raw kind", () => {
    const page = html();
    expect(page).toContain("MESSAGES.kinds[state.step.changeKind]");
    expect(page).toContain('"context":"context"');
  });

  it("styles a context highlight apart from a diff", () => {
    expect(html()).toContain(".badge.context");
  });

  it("keeps the message table addressable from the client script", () => {
    const page = html();
    expect(page).toContain("const MESSAGES = {");
    expect(page).toContain("MESSAGES.stepCounter");
    expect(page).toContain("MESSAGES.staleNotice");
  });
});
