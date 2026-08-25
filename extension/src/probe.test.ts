import { describe, expect, it } from "vitest";

import { AGENT_PROBES, type CommandRunner, probeAgents } from "./probe.js";

function runner(responses: Record<string, string | Error>): CommandRunner {
  return (command, args) => {
    const key = [command, ...args].join(" ");
    const response = responses[key];
    if (response === undefined) {
      return Promise.reject(new Error(`unexpected command: ${key}`));
    }
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve({ stdout: response, stderr: "" });
  };
}

describe("probeAgents", () => {
  it("asks every known agent in a stable order", async () => {
    const asked: string[] = [];
    await probeAgents((command, args) => {
      asked.push([command, ...args].join(" "));
      return Promise.resolve({ stdout: "", stderr: "" });
    });
    expect(asked).toEqual(AGENT_PROBES.map((probe) => [probe.command, ...probe.args].join(" ")));
  });

  it("reports an agent that lists the companion", async () => {
    const results = await probeAgents(
      runner({
        "codex mcp list": "agent-codewalk  /path/to/agent-codewalk-mcp  enabled",
        "claude mcp list": "agent-codewalk: /path - Connected",
        "opencode mcp list": "agent-codewalk connected",
      }),
    );
    expect(results.map((result) => result.status)).toEqual([
      "registered",
      "registered",
      "registered",
    ]);
    expect(results[0]?.detail).toContain("codex mcp list lists agent-codewalk");
  });

  it("tells the user what to do when an agent has not loaded it", async () => {
    const results = await probeAgents(
      runner({
        "codex mcp list": "No MCP servers configured.",
        "claude mcp list": "agent-codewalk: /path - Connected",
        "opencode mcp list": "0 server(s)",
      }),
    );
    expect(results[0]?.status).toBe("not-registered");
    expect(results[0]?.detail).toContain("Setup Agent Integrations");
    expect(results[1]?.status).toBe("registered");
    expect(results[2]?.status).toBe("not-registered");
  });

  it("treats a missing agent as unavailable rather than broken", async () => {
    const results = await probeAgents(
      runner({
        "codex mcp list": new Error("spawn codex ENOENT"),
        "claude mcp list": "agent-codewalk",
        "opencode mcp list": new Error("timed out"),
      }),
    );
    expect(results[0]).toMatchObject({ name: "Codex", status: "unavailable" });
    expect(results[0]?.detail).toContain("ENOENT");
    expect(results[2]?.detail).toContain("timed out");
  });

  it("also looks at what an agent writes to stderr", async () => {
    const results = await probeAgents((command) =>
      command === "claude"
        ? Promise.resolve({ stdout: "", stderr: "agent-codewalk: connected" })
        : Promise.resolve({ stdout: "", stderr: "" }),
    );
    expect(results[1]?.status).toBe("registered");
  });
});
