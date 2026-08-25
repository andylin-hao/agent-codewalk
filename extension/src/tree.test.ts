import { describe, expect, it } from "vitest";

import { ancestorsOf, childrenByParent, expandedForDepth, visibleOrder } from "./tree.js";
import type { WalkthroughStep } from "./types.js";

function step(id: string, depth: number, parentId?: string): WalkthroughStep {
  return {
    id,
    depth,
    ...(parentId === undefined ? {} : { parentId }),
    path: "src/lib.rs",
    title: id,
    explanation: id,
    changeKind: "modify",
    anchor: { startLine: 1, endLine: 1, lineCount: 1, normalizedHash: "0".repeat(64) },
    flowAfter: [],
    targetAvailable: true,
  };
}

/**
 * root
 *   one
 *     one-a
 *   two
 * other
 */
const steps = [
  step("root", 0),
  step("one", 1, "root"),
  step("one-a", 2, "one"),
  step("two", 1, "root"),
  step("other", 0),
];
const order = ["root", "one", "one-a", "two", "other"];
const depths = new Map(steps.map((entry) => [entry.id, entry.depth]));

describe("visibleOrder", () => {
  it("shows only the top level when nothing is expanded", () => {
    expect(visibleOrder(order, depths, new Set())).toEqual(["root", "other"]);
  });

  it("reveals one level per expanded step", () => {
    expect(visibleOrder(order, depths, new Set(["root"]))).toEqual([
      "root",
      "one",
      "two",
      "other",
    ]);
  });

  it("hides a whole subtree, not just the next level", () => {
    // `one` is open but `root` is not, so nothing under `root` shows.
    expect(visibleOrder(order, depths, new Set(["one"]))).toEqual(["root", "other"]);
  });

  it("shows a grandchild once every ancestor is open", () => {
    expect(visibleOrder(order, depths, new Set(["root", "one"]))).toEqual(order);
  });

  it("leaves a flat walkthrough untouched", () => {
    const flat = ["a", "b"];
    const flatDepths = new Map([
      ["a", 0],
      ["b", 0],
    ]);
    expect(visibleOrder(flat, flatDepths, new Set())).toEqual(flat);
  });
});

describe("expandedForDepth", () => {
  it("opens nothing for a single level", () => {
    expect(expandedForDepth(steps, 1)).toEqual(new Set());
  });

  it("opens the top level for two", () => {
    expect(expandedForDepth(steps, 2)).toEqual(new Set(["root", "other"]));
  });

  it("opens deeper levels as the setting grows", () => {
    expect(expandedForDepth(steps, 3)).toEqual(new Set(["root", "other", "one", "two"]));
  });
});

describe("ancestorsOf", () => {
  it("walks the whole chain, not only the parent", () => {
    expect(ancestorsOf(steps, "one-a")).toEqual(["one", "root"]);
  });

  it("returns nothing for a top-level step", () => {
    expect(ancestorsOf(steps, "root")).toEqual([]);
  });

  it("stops rather than looping on a cyclic chain", () => {
    const cyclic = [step("a", 1, "b"), step("b", 1, "a")];
    expect(ancestorsOf(cyclic, "a")).toEqual(["b", "a"]);
  });
});

describe("childrenByParent", () => {
  it("groups each step under the parent it names", () => {
    const children = childrenByParent(steps);
    expect(children.get("root")).toEqual(["one", "two"]);
    expect(children.get("one")).toEqual(["one-a"]);
    expect(children.get("")).toEqual(["root", "other"]);
  });

  it("treats an unknown parent as top level rather than dropping the step", () => {
    expect(childrenByParent([step("orphan", 1, "missing")]).get("")).toEqual(["orphan"]);
  });
});
