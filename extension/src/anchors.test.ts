import { describe, expect, it } from "vitest";

import { hashCodeBlock, resolveAnchor } from "./anchors.js";
import type { CodeAnchor } from "./types.js";

function anchor(startLine: number, value: string): CodeAnchor {
  const lineCount = value.split("\n").length;
  return {
    startLine,
    endLine: startLine + lineCount - 1,
    lineCount,
    normalizedHash: hashCodeBlock(value),
  };
}

describe("resolveAnchor", () => {
  it("uses the line hint when the block still matches", () => {
    expect(resolveAnchor("one\ntwo\n", anchor(2, "two"))).toEqual({
      startLine: 2,
      endLine: 2,
      relocated: false,
    });
  });

  it("relocates a uniquely moved block", () => {
    expect(resolveAnchor("zero\none\ntwo\n", anchor(1, "one\ntwo"))).toEqual({
      startLine: 2,
      endLine: 3,
      relocated: true,
    });
  });

  it("rejects ambiguous blocks", () => {
    expect(resolveAnchor("same\nother\nsame\n", anchor(2, "same"))).toBeUndefined();
  });

  it("rejects missing and oversized blocks", () => {
    expect(resolveAnchor("one\ntwo", anchor(4, "missing"))).toBeUndefined();
    expect(resolveAnchor("one", anchor(2, "one\ntwo"))).toBeUndefined();
  });

  it("normalizes CRLF before hashing", () => {
    expect(hashCodeBlock("one\r\ntwo\r")).toBe(hashCodeBlock("one\ntwo\n"));
  });
});
