import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { SessionStore, candidateRoots, dataDirectory, workspaceFingerprint } from "./storage.js";
import {
  buildStep,
  buildWalkthrough,
  createTemporaryWorkspace,
  fingerprintOf,
  writeSession,
} from "./test/fixtures.js";
import { resetVscodeMock, setConfiguration, setWorkspaceFolders } from "./test/vscode-mock.js";

let workspace: Awaited<ReturnType<typeof createTemporaryWorkspace>>;

beforeEach(async () => {
  resetVscodeMock();
  workspace = await createTemporaryWorkspace();
  vi.stubEnv("AGENT_CODEWALK_HOME", workspace.dataDirectory);
  setWorkspaceFolders([workspace.workspaceRoot]);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await workspace.cleanup();
});

function store(): SessionStore {
  return new SessionStore(vscode.window.createOutputChannel("test", { log: true }));
}

function sampleWalkthrough(root: string, identifier: string, createdAt: string) {
  return buildWalkthrough(
    root,
    [buildStep({ id: "one", path: "src/lib.rs", startLine: 1, endLine: 1, text: "code" })],
    { id: identifier, createdAt },
  );
}

describe("dataDirectory", () => {
  it("prefers the environment variable over the setting", () => {
    setConfiguration("agentCodeWalk.storagePath", "/configured");
    expect(dataDirectory()).toBe(path.resolve(workspace.dataDirectory));
  });

  it("uses the setting when no environment variable is present", () => {
    vi.unstubAllEnvs();
    setConfiguration("agentCodeWalk.storagePath", "/configured/path");
    expect(dataDirectory()).toBe(path.resolve("/configured/path"));
  });

  it("falls back to a platform directory", () => {
    vi.unstubAllEnvs();
    setConfiguration("agentCodeWalk.storagePath", "   ");
    expect(dataDirectory().startsWith(os.homedir()) || dataDirectory().includes("agent-codewalk")).toBe(
      true,
    );
  });
});

describe("workspaceFingerprint", () => {
  it("treats Windows and POSIX separators as the same workspace", () => {
    expect(workspaceFingerprint("C:\\code\\project")).toBe(workspaceFingerprint("C:/code/project"));
  });

  it("separates different workspaces", () => {
    expect(workspaceFingerprint("/a")).not.toBe(workspaceFingerprint("/b"));
  });
});

describe("candidateRoots", () => {
  it("returns the open folder", async () => {
    expect(await candidateRoots()).toEqual([workspace.workspaceRoot]);
  });

  it("adds the repository root when the editor opened a subdirectory", async () => {
    execFileSync("git", ["init", "-q"], { cwd: workspace.workspaceRoot });
    const nested = path.join(workspace.workspaceRoot, "packages", "app");
    await fs.mkdir(nested, { recursive: true });
    setWorkspaceFolders([nested]);

    const roots = await candidateRoots();
    expect(roots).toContain(await fs.realpath(nested));
    expect(roots).toContain(workspace.workspaceRoot);
  });

  it("does not repeat a root that is already the repository root", async () => {
    execFileSync("git", ["init", "-q"], { cwd: workspace.workspaceRoot });
    expect(await candidateRoots()).toEqual([workspace.workspaceRoot]);
  });
});

describe("SessionStore", () => {
  it("returns nothing when no session was ever published", async () => {
    const result = await store().load();
    expect(result.sessions).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads sessions newest first", async () => {
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      sampleWalkthrough(workspace.workspaceRoot, "older", "2026-01-01T00:00:00Z"),
    );
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      sampleWalkthrough(workspace.workspaceRoot, "newer", "2026-02-01T00:00:00Z"),
    );

    const result = await store().load();
    expect(result.sessions.map((session) => session.walkthrough.id)).toEqual(["newer", "older"]);
    expect(result.sessions[0]?.workspaceRoot).toBe(workspace.workspaceRoot);
  });

  it("rejects a session whose fingerprint belongs to another workspace", async () => {
    const foreign = sampleWalkthrough(workspace.workspaceRoot, "foreign", "2026-01-01T00:00:00Z");
    await writeSession(workspace.dataDirectory, workspace.workspaceRoot, {
      ...foreign,
      workspaceFingerprint: fingerprintOf("/somewhere/else"),
    });

    const result = await store().load();
    expect(result.sessions).toEqual([]);
    expect(result.errors[0]).toMatch(/fingerprint does not match/u);
  });

  it("reports an unreadable session without losing the others", async () => {
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      sampleWalkthrough(workspace.workspaceRoot, "good", "2026-01-01T00:00:00Z"),
    );
    const directory = path.join(
      workspace.dataDirectory,
      "workspaces",
      fingerprintOf(workspace.workspaceRoot),
      "sessions",
    );
    await fs.writeFile(path.join(directory, "broken.json"), "{", "utf8");
    await fs.writeFile(path.join(directory, "ignored.txt"), "not a session", "utf8");

    const result = await store().load();
    expect(result.sessions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("collects sessions from every workspace folder", async () => {
    const second = await createTemporaryWorkspace();
    try {
      setWorkspaceFolders([workspace.workspaceRoot, second.workspaceRoot]);
      await writeSession(
        workspace.dataDirectory,
        workspace.workspaceRoot,
        sampleWalkthrough(workspace.workspaceRoot, "first", "2026-01-01T00:00:00Z"),
      );
      await writeSession(
        workspace.dataDirectory,
        second.workspaceRoot,
        sampleWalkthrough(second.workspaceRoot, "second", "2026-03-01T00:00:00Z"),
      );

      const result = await store().load();
      expect(result.sessions.map((session) => session.walkthrough.id)).toEqual([
        "second",
        "first",
      ]);
    } finally {
      await second.cleanup();
    }
  });

  it("deletes only the selected session file", async () => {
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      sampleWalkthrough(workspace.workspaceRoot, "one", "2026-01-01T00:00:00Z"),
    );
    await writeSession(
      workspace.dataDirectory,
      workspace.workspaceRoot,
      sampleWalkthrough(workspace.workspaceRoot, "two", "2026-01-02T00:00:00Z"),
    );
    const sessions = await store().load();
    const target = sessions.sessions.find((session) => session.walkthrough.id === "one");
    if (target === undefined) {
      throw new Error("the fixture session was not loaded");
    }

    await store().delete(target);
    const remaining = await store().load();
    expect(remaining.sessions.map((session) => session.walkthrough.id)).toEqual(["two"]);
  });

  it("notifies when a session appears", async () => {
    let changes = 0;
    const watcher = store().watch(() => {
      changes += 1;
    });
    try {
      // The watch registers asynchronously, so give it the event loop first.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await writeSession(
        workspace.dataDirectory,
        workspace.workspaceRoot,
        sampleWalkthrough(workspace.workspaceRoot, "watched", "2026-01-01T00:00:00Z"),
      );
      await vi.waitFor(
        () => {
          expect(changes).toBeGreaterThan(0);
        },
        { timeout: 5_000, interval: 50 },
      );
    } finally {
      watcher.dispose();
    }
  }, 10_000);

  it("returns a disposable even when the directory cannot be watched", async () => {
    vi.stubEnv("AGENT_CODEWALK_HOME", path.join(workspace.dataDirectory, "file-not-directory"));
    await fs.writeFile(path.join(workspace.dataDirectory, "file-not-directory"), "x", "utf8");
    let changes = 0;
    const watcher = store().watch(() => {
      changes += 1;
    });
    expect(() => {
      watcher.dispose();
    }).not.toThrow();
    expect(changes).toBe(0);
  });
});
