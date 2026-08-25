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
