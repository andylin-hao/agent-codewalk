import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { runTests } from "@vscode/test-electron";

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-codewalk-vscode-"));

try {
  await runTests({
    extensionDevelopmentPath: path.resolve("."),
    extensionTestsPath: path.resolve("dist", "test", "suite.cjs"),
    launchArgs: [workspace, "--disable-extensions"],
  });
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}

