---
name: agent-codewalk
description: Publish a navigable Agent CodeWalk walkthrough the user steps through in their editor, with each block highlighted in place. Use after modifying code (publish_walkthrough), and for requests to analyze, explain, review, trace, or walk through how existing code works (publish_explanation). Do not use for planning, configuration, or questions that do not point at code.
---

# Agent CodeWalk

Turn work on this codebase into a walkthrough the user can step through in VS Code or Cursor, instead of reading a wall of prose and hunting for the lines it refers to.

Two publication paths. Choose by whether the task changed files.

## A. The task changed files

1. Immediately before the first file mutation, call `begin_task` with the user's concrete goal and your agent kind. Retain the returned `taskId` for this task.
2. Complete the requested changes, tests, and documentation normally. Do not publish an intermediate or unverified walkthrough.
3. After verification, inspect every changed text hunk from this task and call `publish_walkthrough` with concise, complete steps:
   - Use workspace-relative paths and exact current 1-based line ranges.
   - Make one step correspond to one code block that the editor can highlight.
   - Explain what changed, why it changed, and the behavior the block now controls.
   - A step may also point at code this task did not touch, when the reader needs it to follow the change. It is recorded as context and highlighted more quietly.
4. If publication reports uncovered hunks, add or expand the relevant steps and retry. Do not claim that a walkthrough exists until publication succeeds.

Call `abort_task` if the coding task is canceled or finishes without file changes. If mutation already started before `begin_task` was called, publish without `taskId`, include `goal` and `agent`, and explicitly tell the user that the resulting `degradedBaseline` session may include pre-existing changes. Do not create protocol files by hand.

## B. The task explains code without changing it

Use `publish_explanation` when the user asks you to analyze, explain, review, trace, or walk through existing code — "how does authentication work", "explain this module", "where does the retry happen", "walk me through the request path".

- No `begin_task`, no baseline, no coverage validation. Just publish when your analysis is done.
- `topic` is the question in the user's own words. `summary` is your answer in a few sentences, for someone who has not opened a file yet.
- Every step must point at code that exists right now; publication fails otherwise.
- Order the steps the way the mechanism actually runs, using `flowAfter`. That order is the explanation.

Still answer in the conversation. The walkthrough is not a replacement for the answer; it is how the user reads the code alongside it. Tell them it is ready.

Skip it for questions that point at no code: how to configure something, what to do next, whether a design is sound.

## Writing a good step

A step is what a colleague would point at while explaining out loud.

- **Title**: the idea, not the location. "Reject an expired token" beats "Update auth.ts".
- **Range**: the smallest block that stands on its own — a function, a branch, a config entry. A range covering a whole file explains nothing; a range covering one brace explains less.
- **Explanation**: for a change, what changed, why, and what now depends on it. For an explanation, what this block decides and what it hands to the next step.
- One step per idea. Two unrelated things in the same function are two steps.

## Using flowAfter

`flowAfter` builds the execution-flow order: the sequence a reader follows to understand how the code actually runs. It is a dependency list, not a narrative order — file order is already computed for you, so repeating it adds nothing.

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
