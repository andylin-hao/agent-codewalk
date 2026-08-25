import type { WalkthroughStep } from "./types.js";

/**
 * The steps that details a given step, keyed by the parent's identifier.
 *
 * A step whose `parentId` names nothing in this walkthrough is treated as top level
 * rather than dropped, so a session that was truncated or hand-edited still plays.
 */
export function childrenByParent(
  steps: readonly WalkthroughStep[],
): ReadonlyMap<string, readonly string[]> {
  const known = new Set(steps.map((step) => step.id));
  const children = new Map<string, string[]>();
  for (const step of steps) {
    const parent = step.parentId !== undefined && known.has(step.parentId) ? step.parentId : "";
    const siblings = children.get(parent);
    if (siblings === undefined) {
      children.set(parent, [step.id]);
    } else {
      siblings.push(step.id);
    }
  }
  return children;
}

/**
 * Narrows a published order to the steps a reader can currently see.
 *
 * Both published orders are pre-order traversals, so a subtree is a contiguous run that
 * starts at its root. Hiding a collapsed step's descendants is therefore a matter of
 * skipping every following entry that is deeper than it, with no tree walk needed.
 *
 * @param order One of the published orders, as a list of step identifiers.
 * @param depths Every step's depth, keyed by identifier.
 * @param expanded The steps whose children are showing.
 * @returns The identifiers to display, in the same relative order.
 */
export function visibleOrder(
  order: readonly string[],
  depths: ReadonlyMap<string, number>,
  expanded: ReadonlySet<string>,
): string[] {
  const visible: string[] = [];
  let hiddenBelow: number | undefined;
  for (const identifier of order) {
    const depth = depths.get(identifier) ?? 0;
    if (hiddenBelow !== undefined && depth > hiddenBelow) {
      continue;
    }
    hiddenBelow = undefined;
    visible.push(identifier);
    if (!expanded.has(identifier)) {
      hiddenBelow = depth;
    }
  }
  return visible;
}

/**
 * The steps that must be open for one step to be reachable.
 *
 * Selecting a step from a search or a code lens has to reveal it, which means expanding
 * every ancestor rather than only its parent.
 */
export function ancestorsOf(
  steps: readonly WalkthroughStep[],
  stepId: string,
): string[] {
  const parents = new Map(steps.map((step) => [step.id, step.parentId]));
  const chain: string[] = [];
  let cursor = parents.get(stepId);
  while (cursor !== undefined && !chain.includes(cursor) && parents.has(cursor)) {
    chain.push(cursor);
    cursor = parents.get(cursor);
  }
  return chain;
}

/**
 * The steps to open so that `levels` levels are showing.
 *
 * Expanding a step reveals its children, so showing two levels means opening everything
 * at depth zero. A walkthrough with no nesting produces an empty set either way.
 */
export function expandedForDepth(
  steps: readonly WalkthroughStep[],
  levels: number,
): Set<string> {
  const expanded = new Set<string>();
  if (levels <= 1) {
    return expanded;
  }
  for (const step of steps) {
    if (step.depth < levels - 1) {
      expanded.add(step.id);
    }
  }
  return expanded;
}
