import { describe, expect, it } from "vitest";

import { EMPTY_GRAPH, buildGraph } from "./graph.js";
import type { StepSummary } from "./types.js";

function step(id: string, flowAfter: readonly string[] = []): StepSummary {
  return {
    id,
    position: 1,
    depth: 0,
    hasChildren: false,
    expanded: false,
    title: id,
    path: `src/${id}.ts`,
    startLine: 1,
    changeKind: "modify",
    hasDiff: false,
    flowAfter,
    active: false,
  };
}

/** Numbers the steps the way `flowOrder` does, so the fixtures match real input. */
function inFlowOrder(...steps: readonly StepSummary[]): StepSummary[] {
  return steps.map((entry, index) => ({ ...entry, position: index + 1 }));
}

/** The lane each step was placed in, keyed by identifier. */
function lanes(steps: readonly StepSummary[]): Record<string, number> {
  return Object.fromEntries(buildGraph(steps).nodes.map((node) => [node.id, node.lane]));
}

describe("buildGraph", () => {
  it("keeps one node per row, in flow order", () => {
    const graph = buildGraph(inFlowOrder(step("a"), step("b", ["a"]), step("c", ["b"])));
    expect(graph.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(graph.nodes.map((node) => node.row)).toEqual([0, 1, 2]);
  });

  it("reuses a lane once nothing depends on its step any more", () => {
    // A straight chain never needs a second lane: each step is the last thing that
    // depends on the one before it, so lane 0 is free again on every row.
    expect(lanes(inFlowOrder(step("a"), step("b", ["a"]), step("c", ["b"])))).toEqual({
      a: 0,
      b: 0,
      c: 0,
    });
  });

  it("opens a second lane while a step still has a dependent to come", () => {
    // `a` stays occupied until `c` is placed, so `b` cannot take lane 0.
    expect(lanes(inFlowOrder(step("a"), step("b"), step("c", ["a"])))).toEqual({
      a: 0,
      b: 1,
      c: 0,
    });
  });

  it("frees every lane that is no longer needed before placing a step", () => {
    // `c` closes both `a` and `b`, so the gutter is back to one lane for `d`.
    expect(lanes(inFlowOrder(step("a"), step("b"), step("c", ["a", "b"]), step("d")))).toEqual({
      a: 0,
      b: 1,
      c: 0,
      d: 0,
    });
  });

  it("reports the widest gutter the layout needs", () => {
    expect(buildGraph(inFlowOrder(step("a"), step("b"), step("c", ["a"]))).laneCount).toBe(2);
    expect(buildGraph(inFlowOrder(step("a"), step("b", ["a"]))).laneCount).toBe(1);
  });

  it("records one edge per predecessor", () => {
    const graph = buildGraph(inFlowOrder(step("a"), step("b"), step("c", ["a", "b"])));
    expect(graph.edges).toEqual([
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ]);
  });

  it("ignores a predecessor that is not part of this walkthrough", () => {
    const graph = buildGraph(inFlowOrder(step("a", ["missing"])));
    expect(graph.nodes.map((node) => node.id)).toEqual(["a"]);
    expect(graph.edges).toEqual([]);
  });

  it("carries the fields a node is rendered from", () => {
    const steps = inFlowOrder({ ...step("a"), title: "Reject an expired token", active: true });
    expect(buildGraph(steps).nodes[0]).toEqual({
      id: "a",
      position: 1,
      title: "Reject an expired token",
      path: "src/a.ts",
      changeKind: "modify",
      active: true,
      depth: 0,
      hasChildren: false,
      expanded: false,
      childCount: 0,
      lane: 0,
      row: 0,
    });
  });

  it("returns an empty graph for no steps", () => {
    expect(buildGraph([])).toEqual(EMPTY_GRAPH);
  });
});
