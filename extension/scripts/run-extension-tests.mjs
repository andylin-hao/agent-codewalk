// Boots a real VS Code, opens a workspace that already has a published walkthrough,
// and runs the extension-host assertions in src/test/suite.ts.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runTests } from "@vscode/test-electron";

const base = await fs.mkdtemp(path.join(os.tmpdir(), "agent-codewalk-vscode-"));
const workspace = await fs.realpath(await makeDirectory(base, "workspace"));
const dataDirectory = await makeDirectory(base, "state");

const LIB_SOURCE = "pub fn ready() -> bool {\n    true\n}\n";
const MAIN_SOURCE = "fn main() {\n    start(ready());\n}\n";

try {
  await writeFile(path.join(workspace, "src", "lib.rs"), LIB_SOURCE);
  await writeFile(path.join(workspace, "src", "main.rs"), MAIN_SOURCE);
  await publishWalkthrough();

  await runTests({
    extensionDevelopmentPath: path.resolve("."),
    extensionTestsPath: path.resolve("dist", "test", "suite.cjs"),
    extensionTestsEnv: { AGENT_CODEWALK_HOME: dataDirectory },
    launchArgs: [workspace, "--disable-extensions"],
  });
} finally {
  await fs.rm(base, { recursive: true, force: true });
}

async function publishWalkthrough() {
  const fingerprint = createHash("sha256").update(workspace.replaceAll("\\", "/")).digest("hex");
  const sessions = path.join(dataDirectory, "workspaces", fingerprint, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  const steps = [
    step("ready", "src/lib.rs", 1, 3, "pub fn ready() -> bool {\n    true\n}", "add", []),
    step("caller", "src/main.rs", 2, 2, "    start(ready());", "modify", ["ready"]),
  ];
  const walkthrough = {
    schemaVersion: 1,
    id: "host-session",
    workspaceFingerprint: fingerprint,
    title: "Add readiness helper",
    summary: "Start-up now consults the readiness helper.",
    agent: { kind: "claude-code" },
    task: {
      id: "host-task",
      goal: "Add a readiness helper",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:01:00Z",
    },
    createdAt: "2026-01-01T00:01:00Z",
    steps,
    fileOrder: ["ready", "caller"],
    flowOrder: ["ready", "caller"],
    changedHunks: [{ path: "src/lib.rs", startLine: 1, endLine: 3, kind: "add" }],
    uncoveredHunks: [],
    excludedChanges: [],
    degradedBaseline: false,
  };
  await fs.writeFile(
    path.join(sessions, "host-session.json"),
    JSON.stringify(walkthrough, undefined, 2),
    "utf8",
  );
}

function step(id, filePath, startLine, endLine, text, changeKind, flowAfter) {
  return {
    id,
    path: filePath,
    title: id === "ready" ? "Expose readiness" : "Consult the helper",
    explanation: `The ${id} block is part of this change.`,
    changeKind,
    anchor: {
      startLine,
      endLine,
      lineCount: endLine - startLine + 1,
      normalizedHash: createHash("sha256").update(text).digest("hex"),
    },
    flowAfter,
    targetAvailable: true,
    ...(id === "caller" ? { previousText: "    start();" } : {}),
  };
}

async function writeFile(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

async function makeDirectory(parent, name) {
  const target = path.join(parent, name);
  await fs.mkdir(target, { recursive: true });
  return target;
}
