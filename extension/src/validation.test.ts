import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { parseWalkthrough } from "./validation.js";

const valid = {
  schemaVersion: 1,
  id: "session",
  workspaceFingerprint: "a".repeat(64),
  title: "Change",
  summary: "Summary",
  agent: { kind: "codex" },
  task: {
    id: "task",
    goal: "goal",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
  },
  createdAt: "2026-01-01T00:01:00Z",
  steps: [
    {
      id: "step",
      path: "src/main.ts",
      title: "Step",
      explanation: "Explanation",
      changeKind: "modify",
      anchor: {
        startLine: 1,
        endLine: 1,
        lineCount: 1,
        normalizedHash: "b".repeat(64),
      },
      flowAfter: [],
      targetAvailable: true,
    },
  ],
  fileOrder: ["step"],
  flowOrder: ["step"],
  changedHunks: [{ path: "src/main.ts", startLine: 1, endLine: 1, kind: "modify" }],
  excludedChanges: [],
  degradedBaseline: false,
};

describe("parseWalkthrough", () => {
  it("accepts the shared cross-language fixture", () => {
    const fixture: unknown = JSON.parse(
      readFileSync(new URL("../../protocol/fixtures/valid-minimal.json", import.meta.url), "utf8"),
    );
    expect(parseWalkthrough(fixture).fileOrder).toEqual(["ready"]);
    const schema: object = JSON.parse(
      readFileSync(new URL("../../protocol/walkthrough-v1.schema.json", import.meta.url), "utf8"),
    ) as object;
    const validate = new Ajv2020({ strict: true, validateFormats: false }).compile(schema);
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  });

  it("accepts a complete v1 document", () => {
    expect(parseWalkthrough(valid).id).toBe("session");
  });

  it("rejects traversal paths", () => {
    const value = structuredClone(valid);
    const firstStep = value.steps.at(0);
    if (firstStep === undefined) {
      throw new Error("test fixture has no steps");
    }
    firstStep.path = "../secret";
    expect(() => parseWalkthrough(value)).toThrow(/parent traversal/u);
  });

  it("requires each order to contain every step", () => {
    const value = structuredClone(valid);
    value.flowOrder = [];
    expect(() => parseWalkthrough(value)).toThrow(/every step exactly once/u);
  });

  it.each([
    ["schema version", { ...valid, schemaVersion: 2 }, /schemaVersion/u],
    ["empty steps", { ...valid, steps: [], fileOrder: [], flowOrder: [] }, /must not be empty/u],
    ["bad hash", { ...valid, workspaceFingerprint: "bad" }, /SHA-256/u],
    ["bad date", { ...valid, createdAt: "not-a-date" }, /ISO date-time/u],
    ["bad agent", { ...valid, agent: { kind: "unknown" } }, /unsupported value/u],
    ["non-array order", { ...valid, fileOrder: null }, /must be an array/u],
    ["empty title", { ...valid, title: "" }, /non-empty string/u],
    ["bad boolean", { ...valid, degradedBaseline: "false" }, /must be a boolean/u],
  ])("rejects %s", (_name, value, expected) => {
    expect(() => parseWalkthrough(value)).toThrow(expected);
  });

  it("rejects invalid ranges and duplicate order entries", () => {
    const range = structuredClone(valid);
    const step = range.steps.at(0);
    if (step === undefined) {
      throw new Error("test fixture has no steps");
    }
    step.anchor.endLine = 0;
    expect(() => parseWalkthrough(range)).toThrow(/positive integer/u);

    const duplicate = structuredClone(valid);
    duplicate.fileOrder = ["step", "step"];
    expect(() => parseWalkthrough(duplicate)).toThrow(/every step exactly once/u);
  });

  it("rejects absolute paths and unknown ordered steps", () => {
    const absolute = structuredClone(valid);
    const step = absolute.steps.at(0);
    if (step === undefined) {
      throw new Error("test fixture has no steps");
    }
    step.path = "/etc/passwd";
    expect(() => parseWalkthrough(absolute)).toThrow(/relative/u);

    const unknown = structuredClone(valid);
    unknown.flowOrder = ["missing"];
    expect(() => parseWalkthrough(unknown)).toThrow(/unknown step/u);
  });

  it("rejects unknown protocol properties and inconsistent anchor metadata", () => {
    expect(() => parseWalkthrough({ ...valid, unexpected: true })).toThrow(/unknown property/u);

    const inconsistent = structuredClone(valid);
    const step = inconsistent.steps.at(0);
    if (step === undefined) {
      throw new Error("test fixture has no steps");
    }
    step.anchor.lineCount = 2;
    expect(() => parseWalkthrough(inconsistent)).toThrow(/lineCount must match/u);
  });

  it("requires flow order to respect unique known predecessors", () => {
    const first = valid.steps.at(0);
    if (first === undefined) {
      throw new Error("test fixture has no steps");
    }
    const duplicate = {
      ...structuredClone(valid),
      steps: [{ ...structuredClone(first), flowAfter: ["missing", "missing"] }],
    };
    expect(() => parseWalkthrough(duplicate)).toThrow(/unique values/u);

    const second = { ...structuredClone(first), id: "second", flowAfter: ["step"] };
    const reversed = {
      ...structuredClone(valid),
      steps: [structuredClone(first), second],
      fileOrder: ["step", "second"],
      flowOrder: ["second", "step"],
    };
    expect(() => parseWalkthrough(reversed)).toThrow(/does not place/u);
  });
});
