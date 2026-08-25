import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import * as vscode from "vscode";

import type { Walkthrough } from "./types.js";
import { parseWalkthrough } from "./validation.js";

const run = promisify(execFile);

/** How long to coalesce filesystem events before reloading sessions. */
const WATCH_DEBOUNCE_MILLISECONDS = 250;

export interface StoredWalkthrough {
  readonly walkthrough: Walkthrough;
  /**
   * The directory step paths are relative to. This is the root the publishing
   * companion recorded, which may be the repository containing the open folder.
   */
  readonly workspaceRoot: string;
  readonly sessionPath: string;
}

export interface SessionLoadResult {
  readonly sessions: readonly StoredWalkthrough[];
  readonly errors: readonly string[];
}

export class SessionStore {
  public constructor(private readonly output: vscode.LogOutputChannel) {}

  /**
   * Loads every session published for this workspace, newest first. Invalid files are
   * reported rather than thrown, so one bad session cannot hide the others.
   */
  public async load(): Promise<SessionLoadResult> {
    const sessions: StoredWalkthrough[] = [];
    const errors: string[] = [];
    for (const workspaceRoot of await candidateRoots()) {
      const fingerprint = workspaceFingerprint(workspaceRoot);
      const sessionsDirectory = path.join(dataDirectory(), "workspaces", fingerprint, "sessions");
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
          if (walkthrough.workspaceFingerprint !== fingerprint) {
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

  /**
   * Notifies when published sessions may have changed. Returns a disposable even when
   * the platform cannot watch the directory, in which case the caller's poll remains
   * the only signal.
   */
  public watch(onChange: () => void): vscode.Disposable {
    const root = path.join(dataDirectory(), "workspaces");
    let timer: NodeJS.Timeout | undefined;
    let watcher: FSWatcher | undefined;
    const schedule = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(onChange, WATCH_DEBOUNCE_MILLISECONDS);
    };
    void fs
      .mkdir(root, { recursive: true })
      .then(() => {
        watcher = watch(root, { recursive: true }, schedule);
        watcher.on("error", (error: unknown) => {
          this.output.warn(`Session watch failed, falling back to polling: ${errorMessage(error)}`);
        });
      })
      .catch((error: unknown) => {
        this.output.warn(`Cannot watch ${root}, falling back to polling: ${errorMessage(error)}`);
      });
    return new vscode.Disposable(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      watcher?.close();
    });
  }
}

/**
 * Returns every directory whose fingerprint may address this workspace's sessions.
 *
 * An agent is often started in the repository root while the editor has a subdirectory
 * open, or the other way around. Considering both keeps sessions visible in either case.
 */
export async function candidateRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderPath = await canonicalPath(folder.uri.fsPath);
    add(roots, folderPath);
    const topLevel = await gitTopLevel(folderPath);
    if (topLevel !== undefined) {
      add(roots, topLevel);
    }
  }
  return roots;
}

function add(roots: string[], candidate: string): void {
  if (!roots.includes(candidate)) {
    roots.push(candidate);
  }
}

async function gitTopLevel(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: directory });
    const resolved = stdout.trim();
    return resolved.length === 0 ? undefined : await canonicalPath(resolved);
  } catch {
    return undefined;
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
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "agent-codewalk",
    );
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "agent-codewalk");
  }
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "agent-codewalk",
  );
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
