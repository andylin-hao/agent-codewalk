import { describe, expect, it } from "vitest";

import {
  removeClaudeStopHook,
  removeCodexConfiguration,
  removeJsonPropertyIfOwned,
  upsertClaudeStopHook,
  upsertCodexConfiguration,
  upsertJsonProperty,
} from "./config-edits.js";

describe("configuration edits", () => {
  it("upserts one idempotent Codex managed block and preserves user TOML", () => {
    const first = upsertCodexConfiguration("model = \"custom\"\n", "/opt/codewalk", "linux");
    const second = upsertCodexConfiguration(first, "/opt/codewalk", "linux");
    expect(second).toBe(first);
    expect(second).toContain("model = \"custom\"");
    expect(second.match(/mcp_servers\.agent-codewalk/gu)).toHaveLength(1);
    expect(second).toContain("--prompt-reminder");
    expect(removeCodexConfiguration(second)).toContain("model = \"custom\"");
  });

  it("refuses to overwrite an unowned Codex entry", () => {
    expect(() =>
      upsertCodexConfiguration("[mcp_servers.agent-codewalk]\ncommand = \"other\"\n", "/ours", "linux"),
    ).toThrow(/unowned/u);
  });

  it("preserves JSONC comments and unrelated MCP servers", () => {
    const source = "{\n  // keep this\n  \"mcpServers\": { \"other\": { \"command\": \"x\" } }\n}\n";
    const updated = upsertJsonProperty(source, ["mcpServers", "agent-codewalk"], {
      command: "/ours",
      args: [],
    });
    expect(updated).toContain("// keep this");
    expect(updated).toContain('"other"');
    expect(removeJsonPropertyIfOwned(updated, ["mcpServers", "agent-codewalk"], "/ours")).not.toContain(
      "agent-codewalk",
    );
    expect(removeJsonPropertyIfOwned(updated, ["mcpServers", "agent-codewalk"], "/other")).toBeUndefined();
  });

  it("adds one Claude Stop hook and removes only the owned hook", () => {
    const source = '{"hooks":{"Stop":[{"hooks":[{"command":"other"}]}]}}';
    const first = upsertClaudeStopHook(source, "/ours", "linux");
    const second = upsertClaudeStopHook(first, "/ours", "linux");
    expect(second.match(/--hook-reminder/gu)).toHaveLength(1);
    expect(second.match(/--prompt-reminder/gu)).toHaveLength(1);
    expect(second).toContain("'/ours' --hook-reminder");
    expect(second).not.toContain('"args"');
    const removed = removeClaudeStopHook(second, "/ours");
    expect(removed).toContain('"other"');
    expect(removed).not.toContain("--hook-reminder");
    expect(removed).not.toContain("--prompt-reminder");
  });

  it("rejects malformed JSONC", () => {
    expect(() => upsertJsonProperty("{ bad", ["mcp"], {})).toThrow(/invalid JSON/u);
  });
});
