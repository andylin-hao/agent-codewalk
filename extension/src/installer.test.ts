import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { IntegrationInstaller, detectedTargets } from "./installer.js";
import { createTemporaryWorkspace } from "./test/fixtures.js";
import { mockState, resetVscodeMock } from "./test/vscode-mock.js";

/**
 * A `~/.claude.json` with the shape real users have: comments, a trailing comma, and a
 * large amount of unrelated state that must survive an edit byte for byte.
 */
const EXISTING_CLAUDE_JSON = `{
  // Managed by the Claude Code CLI.
  "numStartups": 42,
  "projects": {
    "/home/user/work": { "allowedTools": ["Bash(git status)"], "history": ["fix the parser"] }
  },
  "mcpServers": {
    "other-tool": { "type": "stdio", "command": "/usr/local/bin/other-tool", "args": [] },
  }
}
`;

interface Harness {
  readonly home: string;
  readonly extensionPath: string;
  readonly dataDirectory: string;
  readonly installer: IntegrationInstaller;
  cleanup: () => Promise<void>;
}

let harness: Harness;

beforeEach(async () => {
  resetVscodeMock();
  const temporary = await createTemporaryWorkspace();
  const home = path.join(temporary.workspaceRoot, "home");
  const extensionPath = path.join(temporary.workspaceRoot, "extension");
  await fs.mkdir(path.join(extensionPath, "bin"), { recursive: true });
  await fs.mkdir(path.join(extensionPath, "resources", "agent-codewalk"), { recursive: true });
  await fs.writeFile(
    path.join(extensionPath, "resources", "agent-codewalk", "SKILL.md"),
    "---\nname: agent-codewalk\n---\n",
    "utf8",
  );
  await fs.writeFile(path.join(extensionPath, "bin", "agent-codewalk-mcp"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  vi.stubEnv("AGENT_CODEWALK_HOME", temporary.dataDirectory);
  vi.stubEnv("XDG_CONFIG_HOME", path.join(home, ".config"));
  // Detection also looks for agent executables. Emptying PATH keeps these tests
  // dependent only on the temporary home directory, whatever the machine has installed.
  vi.stubEnv("PATH", "");
  const output = vscode.window.createOutputChannel("test", { log: true });
  harness = {
    home,
    extensionPath,
    dataDirectory: temporary.dataDirectory,
    installer: new IntegrationInstaller(
      { extensionPath, extensionUri: vscode.Uri.file(extensionPath) } as vscode.ExtensionContext,
      output,
      home,
      // Diagnostics ask the real agent CLIs which servers they load; the tests answer
      // for them so that nothing depends on what the machine has installed.
      (command) =>
        Promise.resolve({
          stdout: command === "claude" ? "agent-codewalk: connected" : "no servers",
          stderr: "",
        }),
    ),
    cleanup: temporary.cleanup,
  };
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await harness.cleanup();
});

async function createAgentDirectories(...names: string[]): Promise<void> {
  for (const name of names) {
    await fs.mkdir(path.join(harness.home, name), { recursive: true });
  }
}

async function readFile(...segments: string[]): Promise<string> {
  return fs.readFile(path.join(harness.home, ...segments), "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

describe("detectedTargets", () => {
  it("finds nothing for a user with no agent directories", async () => {
    await fs.mkdir(harness.home, { recursive: true });
    expect(await detectedTargets(harness.home)).toEqual([]);
  });

  it("detects an agent from its configuration directory alone", async () => {
    await createAgentDirectories(".codex");
    const targets = await detectedTargets(harness.home);
    expect(targets.map((target) => target.name)).toEqual(["Codex"]);
    expect(targets[0]?.configPath).toBe(path.join(harness.home, ".codex", "config.toml"));
  });

  it("gives Claude Code a hook file so a missed baseline can be reported", async () => {
    await createAgentDirectories(".claude");
    const [target] = await detectedTargets(harness.home);
    expect(target?.hookPath).toBe(path.join(harness.home, ".claude", "settings.json"));
  });
});

describe("IntegrationInstaller.setup", () => {
  it("does nothing until the user confirms", async () => {
    await createAgentDirectories(".codex");
    mockState.informationResponses.push(undefined);

    await harness.installer.setup();

    expect(await exists(path.join(harness.home, ".codex", "config.toml"))).toBe(false);
  });

  it("shows every file it intends to touch before touching it", async () => {
    await createAgentDirectories(".codex");
    mockState.informationResponses.push(undefined);

    await harness.installer.setup();

    expect(mockState.shownMessages[0]).toContain(path.join(harness.home, ".codex", "config.toml"));
    expect(mockState.shownMessages[0]).toContain("agent-codewalk-mcp");
  });

  it("installs the companion, the MCP entry, and the skill for Codex", async () => {
    await createAgentDirectories(".codex");
    mockState.informationResponses.push("Install", undefined);

    await harness.installer.setup();

    const config = await readFile(".codex", "config.toml");
    expect(config).toContain("[mcp_servers.agent-codewalk]");
    expect(config).toContain("[[hooks.Stop]]");
    expect(config).toContain("agent-codewalk managed block");
    expect(
      await exists(path.join(harness.home, ".agents", "skills", "agent-codewalk", "SKILL.md")),
    ).toBe(true);
    expect(
      await exists(
        path.join(
          harness.home,
          ".agents",
          "skills",
          "agent-codewalk",
          ".agent-codewalk-owner.json",
        ),
      ),
    ).toBe(true);
  });

  it("keeps unrelated Claude Code configuration byte for byte", async () => {
    await createAgentDirectories(".claude");
    await fs.writeFile(path.join(harness.home, ".claude.json"), EXISTING_CLAUDE_JSON, "utf8");
    mockState.informationResponses.push("Install", undefined);

    await harness.installer.setup();

    const updated = await readFile(".claude.json");
    expect(updated).toContain("// Managed by the Claude Code CLI.");
    expect(updated).toContain('"numStartups": 42');
    expect(updated).toContain('"other-tool"');
    expect(updated).toContain('"agent-codewalk"');
    expect(await readFile(".claude.json.agent-codewalk.bak")).toBe(EXISTING_CLAUDE_JSON);
  });

  it("adds the Claude Code hooks that recover a missed baseline", async () => {
    await createAgentDirectories(".claude");
    mockState.informationResponses.push("Install", undefined);

    await harness.installer.setup();

    const settings: unknown = JSON.parse(await readFile(".claude", "settings.json"));
    const hooks = (settings as { hooks: Record<string, unknown[]> }).hooks;
    expect(hooks.Stop).toHaveLength(1);
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(JSON.stringify(hooks)).toContain("--hook-reminder");
  });

  it("refuses to overwrite a skill it does not own and rolls that agent back", async () => {
    await createAgentDirectories(".codex");
    const skillPath = path.join(harness.home, ".agents", "skills", "agent-codewalk");
    await fs.mkdir(skillPath, { recursive: true });
    await fs.writeFile(path.join(skillPath, "SKILL.md"), "hand written\n", "utf8");
    mockState.informationResponses.push("Install", undefined);

    await harness.installer.setup();

    expect(await fs.readFile(path.join(skillPath, "SKILL.md"), "utf8")).toBe("hand written\n");
    expect(await exists(path.join(harness.home, ".codex", "config.toml"))).toBe(false);
    expect(mockState.shownMessages.at(-1)).toContain("Codex was skipped");
  });

  it("configures several agents in one run", async () => {
    await createAgentDirectories(".codex", ".claude", ".config/opencode");
    mockState.informationResponses.push("Install", undefined);

    await harness.installer.setup();

    expect(mockState.shownMessages.at(-1)).toContain("Codex");
    expect(mockState.shownMessages.at(-1)).toContain("Claude Code");
    expect(mockState.shownMessages.at(-1)).toContain("OpenCode");
    const openCode: unknown = JSON.parse(await readFile(".config", "opencode", "opencode.json"));
    expect(JSON.stringify(openCode)).toContain("agent-codewalk");
  });

  it("reports a missing companion instead of writing a broken configuration", async () => {
    await createAgentDirectories(".codex");
    await fs.rm(path.join(harness.extensionPath, "bin", "agent-codewalk-mcp"));
    await expect(harness.installer.setup()).rejects.toThrow(/No MCP companion executable/u);
  });
});

describe("IntegrationInstaller.uninstall", () => {
  it("says so when nothing is installed", async () => {
    await harness.installer.uninstall();
    expect(mockState.shownMessages.at(-1)).toContain("No Agent CodeWalk Agent integrations");
  });

  it("removes only what it owns", async () => {
    await createAgentDirectories(".claude");
    await fs.writeFile(path.join(harness.home, ".claude.json"), EXISTING_CLAUDE_JSON, "utf8");
    mockState.informationResponses.push("Install", undefined);
    await harness.installer.setup();
    mockState.warningResponses.push("Remove");

    await harness.installer.uninstall();

    const updated = await readFile(".claude.json");
    expect(updated).toContain('"other-tool"');
    expect(updated).not.toContain('"agent-codewalk"');
    expect(
      await exists(path.join(harness.home, ".claude", "skills", "agent-codewalk")),
    ).toBe(false);
  });

  it("keeps everything when the user declines", async () => {
    await createAgentDirectories(".codex");
    mockState.informationResponses.push("Install", undefined);
    await harness.installer.setup();
    mockState.warningResponses.push(undefined);

    await harness.installer.uninstall();

    expect(await readFile(".codex", "config.toml")).toContain("[mcp_servers.agent-codewalk]");
  });
});

describe("IntegrationInstaller.diagnose", () => {
  it("reports that nothing is installed", async () => {
    await harness.installer.diagnose();
    const channel = mockState.outputChannels.at(-1);
    expect(channel?.lines.join("\n")).toMatch(/No integration installation manifest/u);
  });

  it("reports the installed companion and each configured file", async () => {
    await createAgentDirectories(".codex");
    mockState.informationResponses.push("Install", undefined);
    await harness.installer.setup();

    await harness.installer.diagnose();

    const lines = (mockState.outputChannels.at(0)?.lines ?? []).join("\n");
    expect(lines).toContain("Companion executable: OK");
    expect(lines).toContain("owned skill present");
    expect(lines).toContain("Configured agents: Codex");
    expect(lines).toContain("Claude Code: claude mcp list lists agent-codewalk");
    expect(lines).toContain("Codex: codex mcp list did not list agent-codewalk");
  });
});
