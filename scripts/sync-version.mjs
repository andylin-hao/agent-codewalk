#!/usr/bin/env node
// Propagates the workspace version into every file that repeats it.
//
// Usage:
//   node scripts/sync-version.mjs           write the workspace version everywhere
//   node scripts/sync-version.mjs --check   exit non-zero when a file disagrees

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every location that must repeat the workspace version, with the pattern that
 * isolates it. Each pattern must expose an `indent` and a `version` group.
 *
 * @type {ReadonlyArray<{ readonly file: string, readonly label: string, readonly pattern: RegExp }>}
 */
const sources = [
  {
    file: "package.json",
    label: "workspace package.json",
    pattern: /^(?<indent>\s*"version":\s*")(?<version>[^"]+)(?=")/m,
  },
  {
    file: "extension/package.json",
    label: "extension package.json",
    pattern: /^(?<indent>\s*"version":\s*")(?<version>[^"]+)(?=")/m,
  },
  {
    file: "Cargo.toml",
    label: "cargo workspace",
    pattern: /^(?<indent>version\s*=\s*")(?<version>[^"]+)(?=")/m,
  },
  {
    file: "extension/src/installer.ts",
    label: "installer companion directory",
    pattern: /^(?<indent>(?:export )?const VERSION = ")(?<version>[^"]+)(?=")/m,
  },
];

async function main() {
  const check = process.argv.includes("--check");
  const [reference, ...rest] = sources;
  const expected = await readVersion(reference);
  let failed = false;

  for (const source of rest) {
    const actual = await readVersion(source);
    if (actual === expected) {
      continue;
    }
    if (check) {
      process.stderr.write(
        `${source.file}: expected version ${expected} from ${reference.file}, found ${actual}\n`,
      );
      failed = true;
      continue;
    }
    await writeVersion(source, expected);
    process.stdout.write(`${source.file}: ${actual} -> ${expected}\n`);
  }

  if (failed) {
    process.stderr.write("Run `node scripts/sync-version.mjs` to synchronize.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`All version sources report ${expected}.\n`);
}

/**
 * @param {{ readonly file: string, readonly label: string, readonly pattern: RegExp }} source
 * @returns {Promise<string>}
 */
async function readVersion(source) {
  const absolute = path.join(repoRoot, source.file);
  const content = await fs.readFile(absolute, "utf8");
  const match = source.pattern.exec(content);
  if (match?.groups?.version === undefined) {
    throw new Error(`Cannot locate the version in ${source.file} (${source.label}).`);
  }
  return match.groups.version;
}

/**
 * @param {{ readonly file: string, readonly label: string, readonly pattern: RegExp }} source
 * @param {string} version
 * @returns {Promise<void>}
 */
async function writeVersion(source, version) {
  const absolute = path.join(repoRoot, source.file);
  const content = await fs.readFile(absolute, "utf8");
  const updated = content.replace(source.pattern, `$<indent>${version}`);
  await fs.writeFile(absolute, updated, "utf8");
}

await main();
