import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withFileTransaction } from "./file-transaction.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("file transaction", () => {
  it("commits file and directory changes and removes its snapshots", async () => {
    const root = await temporaryRoot();
    const file = path.join(root, "config.json");
    const directory = path.join(root, "skill");
    const backups = path.join(root, ".transaction");
    await fs.writeFile(file, "before", "utf8");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "old.txt"), "old", "utf8");

    const result = await withFileTransaction(backups, [file, directory, file], async () => {
      await fs.writeFile(file, "after", "utf8");
      await fs.rm(directory, { recursive: true });
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, "new.txt"), "new", "utf8");
      return 42;
    });

    expect(result).toBe(42);
    await expect(fs.readFile(file, "utf8")).resolves.toBe("after");
    await expect(fs.readFile(path.join(directory, "new.txt"), "utf8")).resolves.toBe("new");
    await expect(fs.access(backups)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores existing targets and removes newly created targets after failure", async () => {
    const root = await temporaryRoot();
    const file = path.join(root, "config.json");
    const directory = path.join(root, "skill");
    const created = path.join(root, "adapter.js");
    const backups = path.join(root, ".transaction");
    await fs.writeFile(file, "before", "utf8");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "old.txt"), "old", "utf8");

    await expect(
      withFileTransaction(backups, [file, directory, created], async () => {
        await fs.writeFile(file, "partial", "utf8");
        await fs.rm(directory, { recursive: true });
        await fs.writeFile(created, "partial", "utf8");
        throw new Error("injected failure");
      }),
    ).rejects.toThrow("injected failure");

    await expect(fs.readFile(file, "utf8")).resolves.toBe("before");
    await expect(fs.readFile(path.join(directory, "old.txt"), "utf8")).resolves.toBe("old");
    await expect(fs.access(created)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(backups)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects overlapping targets before the operation runs", async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, "skill");
    const nested = path.join(directory, "SKILL.md");
    let called = false;

    await expect(
      withFileTransaction(path.join(root, ".transaction"), [directory, nested], () => {
        called = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow("targets overlap");
    expect(called).toBe(false);
  });

  it("rejects a snapshot directory inside a target", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "config");

    await expect(
      withFileTransaction(path.join(target, ".transaction"), [target], () => Promise.resolve()),
    ).rejects.toThrow("backup path overlaps target");
  });

  it("cleans partial snapshots when a target cannot be inspected", async () => {
    const root = await temporaryRoot();
    const parentFile = path.join(root, "not-a-directory");
    const backups = path.join(root, ".transaction");
    await fs.writeFile(parentFile, "file", "utf8");

    await expect(
      withFileTransaction(backups, [path.join(parentFile, "child")], () => Promise.resolve()),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
    await expect(fs.access(backups)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the original and rollback errors when restoration is incomplete", async () => {
    const root = await temporaryRoot();
    const file = path.join(root, "config.json");
    const backups = path.join(root, ".transaction");
    await fs.writeFile(file, "before", "utf8");
    const remove = vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("injected rollback failure"));

    try {
      await expect(
        withFileTransaction(backups, [file], async () => {
          await fs.writeFile(file, "partial", "utf8");
          throw new Error("injected operation failure");
        }),
      ).rejects.toMatchObject({
        name: "AggregateError",
        message: "filesystem operation failed and its rollback was incomplete",
      });
    } finally {
      remove.mockRestore();
    }
  });

  it("does not undo committed changes if private snapshot cleanup fails", async () => {
    const root = await temporaryRoot();
    const file = path.join(root, "config.json");
    const backups = path.join(root, ".transaction");
    await fs.writeFile(file, "before", "utf8");
    const remove = vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("injected cleanup failure"));

    try {
      await expect(
        withFileTransaction(backups, [file], async () => {
          await fs.writeFile(file, "after", "utf8");
          return "committed";
        }),
      ).resolves.toBe("committed");
    } finally {
      remove.mockRestore();
    }
    await expect(fs.readFile(file, "utf8")).resolves.toBe("after");
    await expect(fs.access(backups)).resolves.toBeUndefined();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-codewalk-transaction-"));
  temporaryRoots.push(root);
  return root;
}
