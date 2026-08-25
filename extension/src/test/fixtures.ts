// Builders for a realistic on-disk walkthrough, shared by the unit tests.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ChangeHunk,
  ChangeKind,
  Walkthrough,
  WalkthroughKind,
  WalkthroughStep,
} from "../types.js";

export interface StepOptions {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly title?: string;
  readonly explanation?: string;
  readonly changeKind?: ChangeKind;
  readonly flowAfter?: readonly string[];
  readonly targetAvailable?: boolean;
  readonly previousText?: string;
}

export interface WalkthroughOptions {
  readonly id?: string;
  readonly kind?: WalkthroughKind;
  readonly title?: string;
  readonly createdAt?: string;
  readonly degradedBaseline?: boolean;
  readonly uncoveredHunks?: readonly ChangeHunk[];
  readonly fileOrder?: readonly string[];
  readonly flowOrder?: readonly string[];
}

/** Hashes a block the way the companion and the anchor resolver do. */
export function hashBlock(text: string): string {
  return createHash("sha256")
    .update(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"))
    .digest("hex");
}

export function fingerprintOf(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot.replaceAll("\\", "/")).digest("hex");
}

export function buildStep(options: StepOptions): WalkthroughStep {
  return {
    id: options.id,
    path: options.path,
    title: options.title ?? `Step ${options.id}`,
    explanation: options.explanation ?? `Explanation for ${options.id}.`,
    changeKind: options.changeKind ?? "modify",
    anchor: {
      startLine: options.startLine,
      endLine: options.endLine,
      lineCount: options.endLine - options.startLine + 1,
      normalizedHash: hashBlock(options.text),
    },
    flowAfter: options.flowAfter ?? [],
    targetAvailable: options.targetAvailable ?? true,
    ...(options.previousText === undefined ? {} : { previousText: options.previousText }),
  };
}

export function buildWalkthrough(
  workspaceRoot: string,
  steps: readonly WalkthroughStep[],
  options: WalkthroughOptions = {},
): Walkthrough {
  const identifiers = steps.map((step) => step.id);
  return {
    schemaVersion: 1,
    kind: options.kind ?? "change",
    id: options.id ?? "session-1",
    workspaceFingerprint: fingerprintOf(workspaceRoot),
    title: options.title ?? "Add readiness helper",
    summary: "The helper is now consulted before start-up.",
    agent: { kind: "claude-code" },
    task: {
      id: "task-1",
      goal: "Add a readiness helper",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:01:00Z",
    },
    createdAt: options.createdAt ?? "2026-01-01T00:01:00Z",
    steps,
    fileOrder: options.fileOrder ?? identifiers,
    flowOrder: options.flowOrder ?? identifiers,
    changedHunks: options.kind === "explanation" ? [] : steps.map(changedHunkFor),
    uncoveredHunks: options.uncoveredHunks ?? [],
    excludedChanges: [],
    degradedBaseline: options.degradedBaseline ?? false,
  };
}

/** Creates an isolated workspace directory and a matching data directory. */
export async function createTemporaryWorkspace(): Promise<{
  readonly workspaceRoot: string;
  readonly dataDirectory: string;
  cleanup: () => Promise<void>;
}> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "agent-codewalk-test-"));
  const workspaceRoot = await fs.realpath(await createDirectory(base, "workspace"));
  const dataDirectory = await createDirectory(base, "state");
  return {
    workspaceRoot,
    dataDirectory,
    cleanup: () => fs.rm(base, { recursive: true, force: true }),
  };
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const target = path.join(workspaceRoot, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return target;
}

/** Publishes a session the way the companion does, so the store can find it. */
export async function writeSession(
  dataDirectory: string,
  workspaceRoot: string,
  walkthrough: Walkthrough,
): Promise<string> {
  const directory = path.join(
    dataDirectory,
    "workspaces",
    fingerprintOf(workspaceRoot),
    "sessions",
  );
  await fs.mkdir(directory, { recursive: true });
  const sessionPath = path.join(directory, `${walkthrough.id}.json`);
  await fs.writeFile(sessionPath, JSON.stringify(walkthrough, undefined, 2), "utf8");
  return sessionPath;
}

/** Maps a step onto the hunk a real publication would have recorded for it. */
function changedHunkFor(step: WalkthroughStep): ChangeHunk {
  return {
    path: step.path,
    startLine: step.anchor.startLine,
    endLine: step.anchor.endLine,
    kind: step.changeKind === "add" || step.changeKind === "delete" ? step.changeKind : "modify",
  };
}

async function createDirectory(base: string, name: string): Promise<string> {
  const target = path.join(base, name);
  await fs.mkdir(target, { recursive: true });
  return target;
}
