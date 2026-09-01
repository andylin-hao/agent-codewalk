import { describe, expect, it } from "vitest";

import {
  removeAgentHooks,
  removeCodexConfiguration,
  removeJsonPropertyIfOwned,
  upsertAgentHooks,
  upsertCodexConfiguration,
  upsertJsonProperty,
} from "./config-edits.js";

describe("configuration edits", () => {
  it("upserts one idempotent Codex managed block and preserves user TOML", () => {
    const first = upsertCodexConfiguration("model = \"custom\"\n", "/opt/codewalk");
    const second = upsertCodexConfiguration(first, "/opt/codewalk");
    expect(second).toBe(first);
    expect(second).toContain("model = \"custom\"");
    expect(second.match(/mcp_servers\.agent-codewalk/gu)).toHaveLength(1);
    expect(removeCodexConfiguration(second)).toContain("model = \"custom\"");
  });

  it("keeps hooks out of the Codex TOML", () => {
    // Codex loads hooks from hooks.json. Declaring them here as well makes it read two
    // copies and warn about the duplicate representation.
    const block = upsertCodexConfiguration("", "/opt/codewalk");
    expect(block).not.toContain("hooks");
    expect(block).not.toContain("--prompt-reminder");
    expect(block).not.toContain("--hook-reminder");
  });

  it("refuses to overwrite an unowned Codex entry", () => {
    expect(() =>
      upsertCodexConfiguration("[mcp_servers.agent-codewalk]\ncommand = \"other\"\n", "/ours"),
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

  it("adds both agent hooks and removes only the owned ones", () => {
    // The same writer serves Codex's hooks.json and Claude's settings.json, which share
    // this shape.
    const source = '{"hooks":{"Stop":[{"hooks":[{"command":"other"}]}]}}';
    const first = upsertAgentHooks(source, "/ours", "linux");
    const second = upsertAgentHooks(first, "/ours", "linux");
    expect(second.match(/--hook-reminder/gu)).toHaveLength(1);
    expect(second.match(/--prompt-reminder/gu)).toHaveLength(1);
    expect(second).toContain("'/ours' --hook-reminder");
    expect(second).not.toContain('"args"');
    const removed = removeAgentHooks(second, "/ours");
    expect(removed).toContain('"other"');
    expect(removed).not.toContain("--hook-reminder");
    expect(removed).not.toContain("--prompt-reminder");
  });

  it("rejects malformed JSONC", () => {
    expect(() => upsertJsonProperty("{ bad", ["mcp"], {})).toThrow(/invalid JSON/u);
  });
});
