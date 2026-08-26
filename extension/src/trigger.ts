import { promises as fs } from "node:fs";
import path from "node:path";

import * as vscode from "vscode";

import { dataDirectory } from "./storage.js";

/** When an agent should produce a walkthrough. */
export type Trigger = "auto" | "manual";

const SETTINGS_FILE = "settings.json";

/** Reads the configured trigger, treating anything unrecognized as automatic. */
export function configuredTrigger(): Trigger {
  return vscode.workspace.getConfiguration("agentCodeWalk").get<string>("trigger", "auto") ===
    "manual"
    ? "manual"
    : "auto";
}

/**
 * Publishes the trigger where the companion can read it.
 *
 * The companion is started by the agent, not by the editor, so a setting cannot be
 * passed to it as an argument or an environment variable — the two processes share only
 * the data directory. Writing the value there is what lets an editor setting change what
 * an already-configured agent is told to do.
 *
 * Failure is reported to the log rather than thrown: an unwritable data directory means
 * the companion keeps its previous mode, which is a worse experience than intended but
 * not a reason to fail activation.
 *
 * @param output Receives a note when the file cannot be written.
 * @param trigger The mode to record.
 */
export async function writeCompanionTrigger(
  output: vscode.LogOutputChannel,
  trigger: Trigger,
): Promise<void> {
  const target = path.join(dataDirectory(), SETTINGS_FILE);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify({ trigger }, undefined, 2)}\n`, "utf8");
    output.info(`Walkthrough trigger set to ${trigger}.`);
  } catch (error) {
    output.warn(
      `Cannot record the walkthrough trigger at ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
