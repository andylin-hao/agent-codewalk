import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import * as vscode from "vscode";

import type { Walkthrough } from "./types.js";
import { parseWalkthrough } from "./validation.js";

export interface StoredWalkthrough {
  readonly walkthrough: Walkthrough;
  readonly workspaceRoot: string;
  readonly sessionPath: string;
}

export interface SessionLoadResult {
  readonly sessions: readonly StoredWalkthrough[];
  readonly errors: readonly string[];
}

export class SessionStore {
  public constructor(private readonly output: vscode.LogOutputChannel) {}

  public async load(): Promise<SessionLoadResult> {
    const sessions: StoredWalkthrough[] = [];
    const errors: string[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const workspaceRoot = await canonicalPath(folder.uri.fsPath);
      const sessionsDirectory = path.join(
        dataDirectory(),
        "workspaces",
        workspaceFingerprint(workspaceRoot),
        "sessions",
      );
      let entries: string[];
      try {
        entries = await fs.readdir(sessionsDirectory);
      } catch (error) {
        if (isMissing(error)) {
          continue;
        }
        errors.push(`Cannot read ${sessionsDirectory}: ${errorMessage(error)}`);
        continue;
      }
      for (const entry of entries.filter((name) => name.endsWith(".json"))) {
        const sessionPath = path.join(sessionsDirectory, entry);
        try {
          const value: unknown = JSON.parse(await fs.readFile(sessionPath, "utf8"));
          const walkthrough = parseWalkthrough(value);
          if (walkthrough.workspaceFingerprint !== workspaceFingerprint(workspaceRoot)) {
            throw new Error("workspace fingerprint does not match the open folder");
          }
          sessions.push({ walkthrough, workspaceRoot, sessionPath });
        } catch (error) {
          const message = `${entry}: ${errorMessage(error)}`;
          errors.push(message);
          this.output.appendLine(`[invalid session] ${message}`);
        }
      }
    }
    sessions.sort((left, right) =>
      right.walkthrough.createdAt.localeCompare(left.walkthrough.createdAt),
    );
    return { sessions, errors };
  }

  public async delete(session: StoredWalkthrough): Promise<void> {
    await fs.rm(session.sessionPath, { force: true });
  }
}

export function dataDirectory(): string {
  const environment = process.env.AGENT_CODEWALK_HOME;
  if (environment !== undefined && environment.length > 0) {
    return path.resolve(environment);
  }
  const configured = vscode.workspace
    .getConfiguration("agentCodeWalk")
    .get<string>("storagePath", "")
    .trim();
  if (configured.length > 0) {
    return path.resolve(configured);
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "agent-codewalk");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "agent-codewalk");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "agent-codewalk");
}

export function workspaceFingerprint(workspaceRoot: string): string {
  const normalized = workspaceRoot.replaceAll("\\", "/");
  return createHash("sha256").update(normalized).digest("hex");
}

async function canonicalPath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
