---
name: agent-codewalk
description: Publish a navigable Agent CodeWalk explanation after modifying code. Use for coding tasks when the Agent CodeWalk MCP tools are available; do not use for read-only review, planning, or explanation tasks with no file changes.
---

# Agent CodeWalk

Create a walkthrough that lets the user review this task's code changes inside VS Code or Cursor.

## Workflow

1. Immediately before the first file mutation, call `begin_task` with the user's concrete goal and your agent kind. Retain the returned `taskId` for this task.
2. Complete the requested changes, tests, and documentation normally. Do not publish an intermediate or unverified walkthrough.
3. After verification, inspect every changed text hunk from this task and call `publish_walkthrough` with concise, complete steps:
   - Use workspace-relative paths and exact current 1-based line ranges.
   - Make one step correspond to one code block that the editor can highlight.
   - Explain what changed, why it changed, and the behavior the block now controls.
   - Use `flowAfter` only for actual runtime or data-flow predecessors. File order is computed automatically.
4. If publication reports uncovered hunks, add or expand the relevant steps and retry. Do not claim that a walkthrough exists until publication succeeds.

Call `abort_task` if the coding task is canceled or finishes without file changes. If mutation already started before `begin_task` was called, publish without `taskId`, include `goal` and `agent`, and explicitly tell the user that the resulting `degradedBaseline` session may include pre-existing changes. Do not create protocol files by hand.

## Writing a good step

A step is what a colleague would point at while explaining the change out loud.

- **Title**: the change, not the location. "Reject an expired token" beats "Update auth.ts".
- **Range**: the smallest block that stands on its own — a function, a branch, a config entry. A range covering a whole file explains nothing; a range covering one brace explains less.
- **Explanation**: what changed, why, and what now depends on it. Name the behavior a reader would otherwise have to infer.
- One step per idea. Two unrelated edits in the same function are two steps.

## Using flowAfter

`flowAfter` builds the execution-flow order: the sequence a reader follows to understand how the change actually runs. It is a dependency list, not a narrative order — file order is already computed for you, so repeating it adds nothing.

List a predecessor when the reader must have seen that block to understand this one:

- A caller is `flowAfter` the function it calls only when the change flows outward from the callee.
- A handler is `flowAfter` the router entry that dispatches to it.
- A consumer of a new field is `flowAfter` the code that produces it.

Do not list a predecessor for:

- Alphabetical or file order. That is already the other mode.
- "I edited this first." The order you worked in is not the order that explains the change.
- Every earlier step. A chain through all steps carries no more information than the list itself.
- Tests. A test is usually a leaf; nothing runs after it.

Example, for a change that adds a readiness check consulted at start-up:

```
step "expose-readiness"  (src/health.rs)  flowAfter: []
step "consult-readiness" (src/main.rs)    flowAfter: ["expose-readiness"]
step "readiness-test"    (tests/health.rs) flowAfter: ["expose-readiness"]
```

Cycles are rejected, and every identifier in `flowAfter` must name another step in the same walkthrough.
