import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configuredTrigger, writeCompanionTrigger } from "./trigger.js";
import { createTemporaryWorkspace } from "./test/fixtures.js";
import { mockState, resetVscodeMock } from "./test/vscode-mock.js";
import * as vscode from "vscode";

let workspace: Awaited<ReturnType<typeof createTemporaryWorkspace>>;

beforeEach(async () => {
  resetVscodeMock();
  workspace = await createTemporaryWorkspace();
  vi.stubEnv("AGENT_CODEWALK_HOME", workspace.dataDirectory);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await workspace.cleanup();
});

function output(): vscode.LogOutputChannel {
  return vscode.window.createOutputChannel("Agent CodeWalk", { log: true });
}

async function readSettings(): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(workspace.dataDirectory, "settings.json"), "utf8"));
}

describe("configuredTrigger", () => {
  it("is automatic unless the reader chose otherwise", () => {
    expect(configuredTrigger()).toBe("auto");
  });

  it("reads a manual choice", () => {
    mockState.configuration.set("agentCodeWalk.trigger", "manual");
    expect(configuredTrigger()).toBe("manual");
  });

  it("treats an unrecognized value as automatic", () => {
    // Publishing nothing is the worse failure, so anything unexpected keeps walkthroughs.
    mockState.configuration.set("agentCodeWalk.trigger", "later");
    expect(configuredTrigger()).toBe("auto");
  });
});

describe("writeCompanionTrigger", () => {
  it("records the trigger where the companion reads it", async () => {
    await writeCompanionTrigger(output(), "manual");
    expect(await readSettings()).toEqual({ trigger: "manual" });
  });

  it("replaces a previous choice rather than appending to it", async () => {
    await writeCompanionTrigger(output(), "manual");
    await writeCompanionTrigger(output(), "auto");
    expect(await readSettings()).toEqual({ trigger: "auto" });
  });

  it("reports an unwritable directory instead of failing activation", async () => {
    // The companion keeps its previous mode, which is worse than intended but not a
    // reason for the extension to fail to start.
    vi.stubEnv("AGENT_CODEWALK_HOME", path.join(workspace.dataDirectory, "settings.json", "no"));
    await fs.writeFile(path.join(workspace.dataDirectory, "settings.json"), "{}", "utf8");

    await expect(writeCompanionTrigger(output(), "manual")).resolves.toBeUndefined();
    expect(mockState.outputChannels.at(-1)?.lines.join("\n")).toContain(
      "Cannot record the walkthrough trigger",
    );
  });
});
