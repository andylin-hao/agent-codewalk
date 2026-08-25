import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How long an agent CLI may take to list its MCP servers. */
const PROBE_TIMEOUT_MILLISECONDS = 20_000;

const PRODUCT = "agent-codewalk";

export type ProbeStatus = "registered" | "not-registered" | "unavailable";

export interface ProbeResult {
  readonly name: string;
  readonly status: ProbeStatus;
  readonly detail: string;
}

/** The command each agent offers for listing the MCP servers it will actually load. */
export interface AgentProbe {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

export const AGENT_PROBES: readonly AgentProbe[] = [
  { name: "Codex", command: "codex", args: ["mcp", "list"] },
  { name: "Claude Code", command: "claude", args: ["mcp", "list"] },
  { name: "OpenCode", command: "opencode", args: ["mcp", "list"] },
];

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

/**
 * Asks each agent whether it can see the companion.
 *
 * Checking that a configuration file exists only proves the installer wrote one. This
 * asks the agent itself, which is the question a user who reports "nothing happens"
 * actually needs answered.
 *
 * @param run Executes a command. Injected so the probe can be tested without agents.
 * @returns One result per known agent, in a stable order.
 */
export async function probeAgents(run: CommandRunner = defaultRunner): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const probe of AGENT_PROBES) {
    results.push(await probeAgent(probe, run));
  }
  return results;
}

async function probeAgent(probe: AgentProbe, run: CommandRunner): Promise<ProbeResult> {
  const invocation = [probe.command, ...probe.args].join(" ");
  try {
    const { stdout, stderr } = await run(probe.command, probe.args);
    if (`${stdout}\n${stderr}`.includes(PRODUCT)) {
      return { name: probe.name, status: "registered", detail: `${invocation} lists ${PRODUCT}` };
    }
    return {
      name: probe.name,
      status: "not-registered",
      detail: `${invocation} did not list ${PRODUCT}; run Setup Agent Integrations and restart the agent`,
    };
  } catch (error) {
    return {
      name: probe.name,
      status: "unavailable",
      detail: `${invocation} could not be run: ${message(error)}`,
    };
  }
}

async function defaultRunner(
  command: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, [...args], { timeout: PROBE_TIMEOUT_MILLISECONDS });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
