import { promises as fs } from "node:fs";
import path from "node:path";

interface Snapshot {
  readonly target: string;
  readonly backup: string;
  readonly existed: boolean;
  readonly recursive: boolean;
}

/**
 * Runs a group of filesystem mutations as a best-effort transaction.
 *
 * Every target is snapshotted before `operation` starts. If the operation
 * fails, existing files and directories are restored and newly-created
 * targets are removed. Temporary snapshots are deleted after either outcome.
 */
export async function withFileTransaction<T>(
  backupRoot: string,
  targets: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const normalizedTargets = validateTargets(backupRoot, targets);
  const snapshots = await createSnapshots(backupRoot, normalizedTargets);
  let result: T;
  try {
    result = await operation();
  } catch (operationError) {
    try {
      await restoreSnapshots(backupRoot, snapshots);
    } catch (rollbackError) {
      throw new AggregateError(
        [operationError, rollbackError],
        "filesystem operation failed and its rollback was incomplete",
      );
    }
    throw operationError;
  }
  try {
    await removeSnapshots(backupRoot);
  } catch {
    // The mutations are already committed. A stale private snapshot is safer
    // than reporting failure after user-visible files were successfully changed.
  }
  return result;
}

function validateTargets(backupRoot: string, targets: readonly string[]): string[] {
  const root = path.resolve(backupRoot);
  const unique = [...new Set(targets.map((target) => path.resolve(target)))];
  for (const target of unique) {
    if (pathsOverlap(root, target)) {
      throw new Error(`transaction backup path overlaps target: ${target}`);
    }
  }
  for (const [index, target] of unique.entries()) {
    for (const other of unique.slice(index + 1)) {
      if (pathsOverlap(target, other)) {
        throw new Error(`transaction targets overlap: ${target} and ${other}`);
      }
    }
  }
  return unique;
}

function pathsOverlap(left: string, right: string): boolean {
  const comparableLeft = process.platform === "win32" ? left.toLowerCase() : left;
  const comparableRight = process.platform === "win32" ? right.toLowerCase() : right;
  return (
    comparableLeft === comparableRight ||
    comparableLeft.startsWith(`${comparableRight}${path.sep}`) ||
    comparableRight.startsWith(`${comparableLeft}${path.sep}`)
  );
}

async function createSnapshots(
  backupRoot: string,
  targets: readonly string[],
): Promise<Snapshot[]> {
  const snapshots: Snapshot[] = [];
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  try {
    for (const [index, target] of targets.entries()) {
      const backup = path.join(backupRoot, String(index));
      const metadata = await fs.lstat(target).catch((error: unknown) => {
        if (isMissing(error)) {
          return undefined;
        }
        throw error;
      });
      const recursive = metadata?.isDirectory() ?? false;
      if (metadata !== undefined) {
        await fs.cp(target, backup, {
          recursive,
          dereference: false,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
        });
      }
      snapshots.push({ target, backup, existed: metadata !== undefined, recursive });
    }
    return snapshots;
  } catch (error) {
    await removeSnapshots(backupRoot);
    throw error;
  }
}

async function restoreSnapshots(
  backupRoot: string,
  snapshots: readonly Snapshot[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    try {
      await fs.rm(snapshot.target, { recursive: true, force: true });
      if (snapshot.existed) {
        await fs.mkdir(path.dirname(snapshot.target), { recursive: true });
        await fs.cp(snapshot.backup, snapshot.target, {
          recursive: snapshot.recursive,
          dereference: false,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
        });
      }
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await removeSnapshots(backupRoot);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "could not restore every filesystem target");
  }
}

async function removeSnapshots(backupRoot: string): Promise<void> {
  await fs.rm(backupRoot, { recursive: true, force: true });
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
