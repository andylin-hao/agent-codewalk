import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DIFF_SCHEME, StepDiffProvider } from "./diff.js";
import { buildStep } from "./test/fixtures.js";
import { mockState, resetVscodeMock } from "./test/vscode-mock.js";

let provider: StepDiffProvider;

beforeEach(() => {
  resetVscodeMock();
  provider = new StepDiffProvider();
});

afterEach(() => {
  provider.dispose();
});

const step = buildStep({
  id: "caller",
  path: "src/main.rs",
  startLine: 2,
  endLine: 2,
  text: "    start(ready());",
  previousText: "    start();",
});

describe("StepDiffProvider", () => {
  it("registers itself for its own scheme", () => {
    provider.register();
    expect(mockState.contentProviders.has(DIFF_SCHEME)).toBe(true);
    provider.dispose();
    expect(mockState.contentProviders.has(DIFF_SCHEME)).toBe(false);
  });

  it("opens a diff of the recorded and the current text", async () => {
    const shown = await provider.show(step, "    start(ready());");
    expect(shown).toBe(true);

    const call = mockState.executedCommands.find((entry) => entry.command === "vscode.diff");
    expect(call).toBeDefined();
    const [before, after, title] = call?.args ?? [];
    expect(String(before)).toContain(`${DIFF_SCHEME}:/before/caller/main.rs`);
    expect(String(after)).toContain(`${DIFF_SCHEME}:/after/caller/main.rs`);
    expect(title).toBe("Step caller — before ↔ after");
  });

  it("serves the recorded content for each side", async () => {
    await provider.show(step, "    start(ready());");
    const call = mockState.executedCommands.find((entry) => entry.command === "vscode.diff");
    const [before, after] = (call?.args ?? []) as { toString: () => string }[];
    expect(provider.provideTextDocumentContent(before as never)).toBe("    start();");
    expect(provider.provideTextDocumentContent(after as never)).toBe("    start(ready());");
  });

  it("returns nothing for an unknown document", () => {
    expect(provider.provideTextDocumentContent({ toString: () => "other:/x" } as never)).toBe("");
  });

  it("declines a step that never recorded a baseline", async () => {
    const added = buildStep({
      id: "new",
      path: "src/lib.rs",
      startLine: 1,
      endLine: 1,
      text: "fn added() {}",
    });
    expect(await provider.show(added, "fn added() {}")).toBe(false);
    expect(mockState.executedCommands).toHaveLength(0);
  });

  it("keeps a file without an extension addressable", async () => {
    const noExtension = buildStep({
      id: "make",
      path: "Makefile",
      startLine: 1,
      endLine: 1,
      text: "all:",
      previousText: "build:",
    });
    expect(await provider.show(noExtension, "all:")).toBe(true);
    const call = mockState.executedCommands.find((entry) => entry.command === "vscode.diff");
    expect(String(call?.args[0])).toContain("/before/make/Makefile");
  });
});
