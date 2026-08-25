import type { GraphEdge, GraphNode, StepGraph, StepSummary } from "./types.js";

/**
 * The widest gutter the sidebar can spare. Beyond this, deeper lanes are clamped onto
 * the last one: a slightly ambiguous edge is better than a graph pushed off screen.
 */
const MAX_LANES = 8;

/**
 * Lays the steps out as a vertical rail: one step per row, dependencies as lanes.
 *
 * A layered layout puts every independent step side by side, which reads well for six
 * steps and collapses for fifty — rows overflow sideways and titles shrink to nothing.
 * Stacking one step per row instead gives every title the full width and makes height,
 * not width, grow with the walkthrough. The lanes carry the structure the rows lose.
 *
 * Only the steps currently displayed are passed in, so a collapsed subtree contributes
 * neither rows nor lanes and the rail shrinks to the level being read.
 *
 * @param steps The visible steps in execution-flow order.
 * @param childCounts How many steps detail each one, for the badge on a closed parent.
 * @returns Nodes in flow order with their lane assigned, the lane count, and the edges.
 */
export function buildGraph(
  steps: readonly StepSummary[],
  childCounts: ReadonlyMap<string, number> = new Map(),
): StepGraph {
  const known = new Set(steps.map((step) => step.id));

  // A lane stays occupied until the row of the last step that depends on it. It is freed
  // on that row rather than after it, so a chain hands its lane down and stays a single
  // straight line instead of stepping right at every link.
  const lastNeeded = new Map<string, number>(steps.map((step, row) => [step.id, row]));
  steps.forEach((step, row) => {
    for (const id of step.flowAfter) {
      if (known.has(id)) {
        lastNeeded.set(id, Math.max(lastNeeded.get(id) ?? row, row));
      }
    }
  });

  const occupied: (string | undefined)[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  steps.forEach((step, row) => {
    for (const [index, holder] of occupied.entries()) {
      if (holder !== undefined && (lastNeeded.get(holder) ?? row) <= row) {
        occupied[index] = undefined;
      }
    }
    const free = occupied.indexOf(undefined);
    const lane = free === -1 ? occupied.length : free;
    occupied[lane] = step.id;

    nodes.push({
      id: step.id,
      position: step.position,
      title: step.title,
      path: step.path,
      changeKind: step.changeKind,
      active: step.active,
      depth: step.depth,
      hasChildren: step.hasChildren,
      expanded: step.expanded,
      childCount: childCounts.get(step.id) ?? 0,
      lane: Math.min(lane, MAX_LANES - 1),
      row,
    });
    for (const id of step.flowAfter) {
      if (known.has(id)) {
        edges.push({ from: id, to: step.id });
      }
    }
  });

  const laneCount = nodes.reduce((widest, node) => Math.max(widest, node.lane + 1), 0);
  return { nodes, laneCount, edges };
}

/** The empty graph, for a view state with no active walkthrough. */
export const EMPTY_GRAPH: StepGraph = { nodes: [], laneCount: 0, edges: [] };
