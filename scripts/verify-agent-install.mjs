#!/usr/bin/env node
// Asks every supported agent which MCP servers it loads, and reports whether the
// Agent CodeWalk companion is among them.
//
// A configuration file the installer wrote is not evidence that an agent reads it.
// This is the check to run after changing an installation path, and the one to ask a
// user to run when they report that nothing happens.
//
// Usage: node scripts/verify-agent-install.mjs

import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

const PRODUCT = "agent-codewalk";
const TIMEOUT_MILLISECONDS = 30_000;

/** Each agent, the command that lists its MCP servers, and where it loads skills from. */
const agents = [
  {
    name: "Codex",
    command: "codex",
    args: ["mcp", "list"],
    skillPath: "~/.agents/skills/agent-codewalk",
  },
  {
    name: "Claude Code",
    command: "claude",
    args: ["mcp", "list"],
    skillPath: "~/.claude/skills/agent-codewalk",
  },
  {
    name: "OpenCode",
    command: "opencode",
    args: ["mcp", "list"],
    skillPath: "~/.agents/skills/agent-codewalk",
  },
];

let failures = 0;

for (const agent of agents) {
  const invocation = [agent.command, ...agent.args].join(" ");
  try {
    const { stdout, stderr } = await run(agent.command, agent.args, {
      timeout: TIMEOUT_MILLISECONDS,
    });
    if (`${stdout}\n${stderr}`.includes(PRODUCT)) {
      report("ok", agent.name, `${invocation} lists ${PRODUCT}`);
    } else {
      failures += 1;
      report("missing", agent.name, `${invocation} does not list ${PRODUCT}`);
    }
  } catch (error) {
    report("skipped", agent.name, `${invocation} could not be run: ${describe(error)}`);
  }
  report("note", agent.name, `skill directory: ${agent.skillPath}`);
}

process.stdout.write(
  failures === 0
    ? "\nEvery available agent can see the companion.\n"
    : `\n${String(failures)} agent(s) cannot see the companion. Run “Agent CodeWalk: Setup Agent Integrations”, then restart the agent session.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;

/**
 * @param {"ok" | "missing" | "skipped" | "note"} outcome
 * @param {string} name
 * @param {string} detail
 */
function report(outcome, name, detail) {
  const marks = { ok: "PASS", missing: "FAIL", skipped: "SKIP", note: "    " };
  process.stdout.write(`${marks[outcome]}  ${name.padEnd(12)} ${detail}\n`);
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}
