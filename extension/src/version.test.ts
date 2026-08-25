import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** Every file that repeats the workspace version, with the pattern that isolates it. */
const sources = [
  { file: "package.json", pattern: /"version":\s*"([^"]+)"/u },
  { file: "extension/package.json", pattern: /"version":\s*"([^"]+)"/u },
  { file: "Cargo.toml", pattern: /^version\s*=\s*"([^"]+)"/mu },
  { file: "extension/src/installer.ts", pattern: /^const VERSION = "([^"]+)"/mu },
] as const;

function read(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
}

describe("version consistency", () => {
  it.each(sources.map((source) => [source.file, source] as const))(
    "declares a version in %s",
    (_file, source) => {
      expect(source.pattern.exec(read(source.file))?.[1]).toMatch(/^\d+\.\d+\.\d+$/u);
    },
  );

  it("keeps every version source in step", () => {
    const versions = sources.map((source) => ({
      file: source.file,
      version: source.pattern.exec(read(source.file))?.[1],
    }));
    const distinct = new Set(versions.map((entry) => entry.version));
    expect(
      [...distinct],
      `run node scripts/sync-version.mjs — ${JSON.stringify(versions)}`,
    ).toHaveLength(1);
  });

  it("ships the companion under a version-specific directory", () => {
    const installer = read("extension/src/installer.ts");
    expect(installer).toContain('path.join(dataDirectory(), "bin", VERSION, executableName())');
  });
});
