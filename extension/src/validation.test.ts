import { readFileSync } from "node:fs";

import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { parseWalkthrough } from "./validation.js";

type JsonObject = Record<string, unknown>;

interface NegativeCase {
  readonly name: string;
  /**
   * Which layer first rejects the document:
   * - `deserialization`: the JSON Schema, this validator, and Rust `serde` all reject it.
   * - `schema`: the JSON Schema and this validator reject it; Rust enforces it at publish time.
   * - `semantics`: the JSON Schema accepts it and only this validator rejects it.
   */
  readonly layer: "deserialization" | "schema" | "semantics";
  readonly expect: string;
  readonly set?: Readonly<Record<string, unknown>>;
  readonly delete?: readonly string[];
}

interface NegativeFixture {
  readonly base: JsonObject;
  readonly cases: readonly NegativeCase[];
}

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../protocol/fixtures/${name}`, import.meta.url), "utf8"),
  );
}

const schema = readFixture("../walkthrough-v1.schema.json") as object;
const validMinimal = readFixture("valid-minimal.json");
const negative = readFixture("invalid.json") as NegativeFixture;
const validateAgainstSchema: ValidateFunction = new Ajv2020({
  strict: true,
  validateFormats: false,
}).compile(schema);

/** Applies a case mutation, addressing nested values with dotted paths. */
function mutate(base: JsonObject, testCase: NegativeCase): JsonObject {
  const document = structuredClone(base);
  for (const [path, value] of Object.entries(testCase.set ?? {})) {
    assign(document, path.split("."), value);
  }
  for (const path of testCase.delete ?? []) {
    assign(document, path.split("."), undefined);
  }
  return document;
}

function assign(target: unknown, segments: readonly string[], value: unknown): void {
  const [head, ...rest] = segments;
  if (head === undefined) {
    throw new Error("a fixture path must not be empty");
  }
  if (typeof target !== "object" || target === null) {
    throw new Error(`fixture path does not address an object: ${segments.join(".")}`);
  }
  const container = target as JsonObject;
  if (rest.length === 0) {
    if (value === undefined) {
      Reflect.deleteProperty(container, head);
    } else {
      container[head] = value;
    }
    return;
  }
  assign(container[head], rest, value);
}

describe("parseWalkthrough", () => {
  it("accepts the shared minimal fixture and the schema agrees", () => {
    expect(parseWalkthrough(validMinimal).fileOrder).toEqual(["ready"]);
    expect(validateAgainstSchema(validMinimal), JSON.stringify(validateAgainstSchema.errors)).toBe(
      true,
    );
  });

  it("accepts the multi-step negative-fixture base", () => {
    const parsed = parseWalkthrough(negative.base);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.flowOrder).toEqual(["ready", "caller"]);
    expect(validateAgainstSchema(negative.base), JSON.stringify(validateAgainstSchema.errors)).toBe(
      true,
    );
  });

  it("covers every enforcement layer", () => {
    const layers = new Set(negative.cases.map((testCase) => testCase.layer));
    expect([...layers].sort()).toEqual(["deserialization", "schema", "semantics"]);
  });

  it.each(negative.cases.map((testCase) => [testCase.name, testCase] as const))(
    "rejects %s",
    (_name, testCase) => {
      const document = mutate(negative.base, testCase);
      expect(() => parseWalkthrough(document)).toThrow(testCase.expect);
    },
  );

  it.each(negative.cases.map((testCase) => [testCase.name, testCase] as const))(
    "agrees with the JSON Schema about %s",
    (_name, testCase) => {
      const document = mutate(negative.base, testCase);
      const accepted = validateAgainstSchema(document);
      expect(accepted).toBe(testCase.layer === "semantics");
    },
  );

  it("keeps an optional previous-text excerpt", () => {
    const document = structuredClone(negative.base);
    assign(document, ["steps", "0", "previousText"], "let ready = false;");
    expect(parseWalkthrough(document).steps[0]?.previousText).toBe("let ready = false;");
    expect(validateAgainstSchema(document)).toBe(true);
  });

  it("rejects a previous-text excerpt longer than the companion can emit", () => {
    const document = structuredClone(negative.base);
    assign(document, ["steps", "0", "previousText"], "x".repeat(4_101));
    expect(() => parseWalkthrough(document)).toThrow(/at most 4100 characters/u);
  });

  it("reports the failing field in the message", () => {
    const document = structuredClone(negative.base);
    assign(document, ["steps", "1", "anchor", "normalizedHash"], "short");
    expect(() => parseWalkthrough(document)).toThrow(/steps\[1\]\.anchor\.normalizedHash/u);
  });

  it("accepts uncovered hunks on a degraded session", () => {
    const document = structuredClone(negative.base);
    assign(document, ["degradedBaseline"], true);
    assign(document, ["uncoveredHunks"], [
      { path: "src/other.rs", startLine: 1, endLine: 2, kind: "modify" },
    ]);
    expect(parseWalkthrough(document).uncoveredHunks).toHaveLength(1);
    expect(validateAgainstSchema(document)).toBe(true);
  });
});
