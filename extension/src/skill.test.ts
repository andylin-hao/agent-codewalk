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

  /**
   * Presentation is the product here: a walkthrough of wide ranges and reasonless
   * paragraphs is worse than no walkthrough, because the reader still has to work out
   * what the agent meant. These assertions fail when a rewrite drops a rule.
   */
  it("bounds how much code one step may cover", () => {
    expect(skill).toContain("Keep the range tight");
    expect(skill).toMatch(/5 to 25 lines/u);
  });

  it("requires a reason on every step of a change walkthrough", () => {
    expect(skill).toContain("must state a reason");
  });

  it("fixes the shape of a step explanation", () => {
    const section = skill.slice(skill.indexOf("## Writing the explanation"));
    expect(section).toContain("Three or four sentences per step");
    expect(section).toContain("Restate the title, the path, or the line numbers");
  });

  it("asks for a decomposed walkthrough rather than a flat list", () => {
    expect(skill).toContain("3 to 7 top-level steps");
    expect(skill).toContain("parentId");
    expect(skill).toContain("Two levels suits most work");
  });

  it("keeps flowAfter within one level", () => {
    expect(skill).toContain("`flowAfter` names siblings only");
  });

  it("asks for the user's language and its own conventions", () => {
    expect(skill).toContain("Write in the language the user is writing in");
    expect(skill).toContain("follow that language's own conventions");
  });
});
