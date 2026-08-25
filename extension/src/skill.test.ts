import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The portable skill is how an agent decides to use this tool at all, so its triggers
 * are part of the product rather than documentation. These assertions fail when a
 * rewrite quietly drops one.
 */
const skill = readFileSync(
  new URL("../resources/agent-codewalk/SKILL.md", import.meta.url),
  "utf8",
);

const frontMatter = /^---\n([\s\S]*?)\n---/u.exec(skill)?.[1] ?? "";

describe("the portable skill", () => {
  it("declares the name the installer writes", () => {
    expect(frontMatter).toContain("name: agent-codewalk");
  });

  it.each([
    ["analyze"],
    ["explain"],
    ["review"],
    ["trace"],
    ["walk through"],
    ["publish_walkthrough"],
    ["publish_explanation"],
  ])("offers itself for %s", (trigger) => {
    expect(frontMatter.toLowerCase()).toContain(trigger);
  });

  it("documents both publication paths", () => {
    expect(skill).toContain("The task changed files");
    expect(skill).toContain("The task explains code without changing it");
  });

  it("keeps begin_task attached to the change path only", () => {
    const explanation = skill.slice(skill.indexOf("## B."));
    expect(explanation).toContain("No `begin_task`");
  });

  it("still tells the agent to answer in the conversation", () => {
    expect(skill).toContain("Still answer in the conversation");
  });

  it("says when not to publish anything", () => {
    expect(skill).toContain("Skip it for questions that point at no code");
  });
});
