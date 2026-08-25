import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { format, messagesFor } from "./i18n.js";
import type { ChangeKind } from "./types.js";

describe("messagesFor", () => {
  it.each([["zh-cn"], ["zh-CN"], ["zh-tw"], ["zh"]])("uses Chinese for %s", (language) => {
    expect(messagesFor(language).next).toBe("下一步");
  });

  it.each([["en"], ["en-us"], ["de"], ["pt-br"], [""]])(
    "falls back to English for %s",
    (language) => {
      expect(messagesFor(language).next).toBe("Next");
    },
  );

  it("translates every key it declares", () => {
    const english = messagesFor("en");
    const chinese = messagesFor("zh-cn");
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(chinese[key], `${key} is missing a translation`).not.toEqual([]);
      expect(chinese[key], `${key} is empty`).toBeTruthy();
    }
  });

  it("keeps the same number of onboarding steps in both languages", () => {
    expect(messagesFor("zh-cn").emptySteps).toHaveLength(messagesFor("en").emptySteps.length);
  });

  it("labels every change kind in both languages", () => {
    const kinds: ChangeKind[] = ["add", "modify", "delete", "rename", "context"];
    for (const language of ["en", "zh-cn"]) {
      const table = messagesFor(language).kinds;
      expect(Object.keys(table).sort()).toEqual([...kinds].sort());
      for (const kind of kinds) {
        expect(table[kind], `${language} is missing ${kind}`).toBeTruthy();
      }
    }
  });

  it("keeps every placeholder a template declares", () => {
    const english = messagesFor("en");
    const chinese = messagesFor("zh-cn");
    for (const key of [
      "stepCounter",
      "publishedNotice",
      "explanationPublishedNotice",
    ] as const) {
      expect(placeholders(chinese[key]), key).toEqual(placeholders(english[key]));
    }
  });
});

describe("format", () => {
  it("substitutes positional values", () => {
    expect(format("Step {0} of {1}", 3, 12)).toBe("Step 3 of 12");
  });

  it("leaves a placeholder with no value in place", () => {
    expect(format("Step {0} of {1}", 3)).toBe("Step 3 of {1}");
  });

  it("returns a template without placeholders unchanged", () => {
    expect(format("Next")).toBe("Next");
  });
});

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{\d+\}/gu)].map((match) => match[0]).sort();
}

describe("manifest localization", () => {
  const manifest = readJson("package.json");
  const english = readJson("package.nls.json");
  const chinese = readJson("package.nls.zh-cn.json");

  it("resolves every placeholder the manifest uses", () => {
    const used = [...JSON.stringify(manifest).matchAll(/%([\w.]+)%/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    expect(used.length).toBeGreaterThan(10);
    for (const key of new Set(used)) {
      expect(english, `package.nls.json is missing ${key}`).toHaveProperty(key);
    }
  });

  it("translates every key", () => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(chinese)) {
      expect(String(value).length, `${key} is empty`).toBeGreaterThan(0);
    }
  });

  it("ships both bundles in the package", () => {
    expect(manifest.files).toContain("package.nls.json");
    expect(manifest.files).toContain("package.nls.zh-cn.json");
  });
});

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;
}
