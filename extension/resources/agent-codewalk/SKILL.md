---
name: agent-codewalk
description: Publish a navigable Agent CodeWalk walkthrough the user steps through in their editor, with each block highlighted in place. Use after modifying code (publish_walkthrough), and for requests to analyze, explain, review, trace, or walk through how existing code works (publish_explanation). Do not use for planning, configuration, or questions that do not point at code.
---

# Agent CodeWalk

Turn work on this codebase into a walkthrough the user can step through in VS Code or Cursor, instead of reading a wall of prose and hunting for the lines it refers to.

Two publication paths. Choose by whether the task changed files.

A workspace may be set to publish on request only. The MCP server says so in its
instructions when it is; follow that, and do not record a baseline for a coding task the
user has not asked for a walkthrough of. Everything below still applies once they do ask,
and an explanation is always a request.

## A. The task changed files

1. Immediately before the first file mutation, call `begin_task` with the user's concrete goal and your agent kind. Retain the returned `taskId` for this task.
2. Complete the requested changes, tests, and documentation normally. Do not publish an intermediate or unverified walkthrough.
3. After verification, inspect every changed text hunk from this task and call `publish_walkthrough` with concise, complete steps:
   - Use workspace-relative paths and exact current 1-based line ranges.
   - Make one step correspond to one code block that the editor can highlight, kept as narrow as the idea allows.
   - Say what changed, why it changed, and what the block now controls. The reason is required, not optional.
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

## Structuring the walkthrough

A reader should meet a handful of steps, not a list of fifty. Give the walkthrough **3 to 7 top-level steps** that carry the overall flow, then detail each one with children that name it in `parentId`.

- **Decompose before you write.** Decide the top level first — the stages a colleague would name out loud — then fill each one in. A flat list published in the order you happened to edit is the thing this replaces.
- **A top-level step must stand alone.** Someone who reads only the top level should understand what the task did, or how the mechanism works, without opening a child.
- **Two levels suits most work.** Nest deeper only where a child genuinely decomposes again. Depth is capped at eight, which is a guard, not a target.
- **Detail is read, not skipped.** A reader pressing next moves through your top level and opens each step as they reach it, so a child is on the path rather than off it.
- **A parent is a real step.** It points at the block that *is* the overall flow: the dispatcher, the entry point, the function that delegates. Give it a range like any other step.
- **Or let it inherit one.** A step with children may omit `startLine` and `endLine`, and takes the block of its first child in the same file. Use this when the parent is genuinely represented by the first thing under it, not to avoid choosing.
- **`flowAfter` names siblings only.** Execution order is a property of one level; a predecessor with a different parent is rejected.

## Choosing the code block

A step is what a colleague would point at while explaining out loud: one block, on one screen.

- **One idea per step.** Two unrelated things in the same function are two steps.
- **Keep the range tight.** Prefer 5 to 25 lines and treat 40 as the ceiling. A range covering a whole file, a whole class, or a 200-line function explains nothing, because the reader cannot tell which lines you meant.
- **Split rather than widen.** A long function becomes a step for the guard clauses, a step for the branch that carries the logic, and a step for what it returns.
- **Never stretch a range to satisfy coverage.** If a changed hunk falls outside every natural block, give it its own step instead of growing a neighboring one until it swallows the hunk.
- **Title the idea, not the location.** "Reject an expired token" beats "Update auth.ts".
- **Lead with the code.** A reader opens a walkthrough to learn what the change does, and
  that lives in the source. Keep configuration and documentation steps out of the top
  level unless the task was about them; publication already orders siblings so source
  comes before configuration, and configuration before documentation.

## Writing the explanation

The reader has your words on one side and the highlighted code on the other, and has not seen this code before. Explain and guide. Do not summarize, and do not sell.

**Language.** Write in the language the user is writing in, and follow that language's own conventions instead of translating your usual phrasing: Chinese prose uses 全角标点 and Chinese sentence rhythm, English prose uses plain active voice. Keep identifiers, paths, and tool names in their original form in every language.

**Form.** Three or four sentences per step, in this order:

1. What the block does, or what changed in it.
2. Why it is written that way, or why it changed.
3. What depends on it now, or what it hands to the next step.

**Every step of a change walkthrough must state a reason.** A step that reports only what changed is incomplete. Say what was wrong before, what forced the change, or what would break without it. A reviewer reads the walkthrough to judge the change and cannot judge one whose motive is missing.

**The summary** answers the question, or states what the task did, in two to four sentences for someone who has not opened a file yet. Lead with the answer, then give the shape of it.

Do not:

- Restate the title, the path, or the line numbers. The reader can see all three.
- Open with "This code", "This function", or "This step".
- Explain what the code already says plainly. A getter that returns a field needs no step.
- Write a bulleted changelog. This is prose the reader follows in order.

## Using flowAfter

`flowAfter` orders one set of siblings, and is also what the sidebar graph draws: one step per row at the level being read, with a line from each step down to whatever depends on it. It is a dependency list, not a narrative order, and file order is already computed for you.

List a predecessor when the reader must have seen that block to understand this one:

- A caller is `flowAfter` the function it calls only when the change flows outward from the callee.
- A handler is `flowAfter` the router entry that dispatches to it.
- A consumer of a new field is `flowAfter` the code that produces it.

Do not list a predecessor for:

- Alphabetical or file order. That is already the other mode.
- "I edited this first." The order you worked in is not the order that explains the change.
- Every earlier sibling. A chain through all of them carries no more information than the list itself, and it collapses the graph into one straight line.
- A step at another level. That is what `parentId` expresses, and publication rejects it.
- Tests. A test is usually a leaf; nothing runs after it.

Example, for a change that adds a readiness check consulted at start-up:

```
step "expose-readiness"  (src/health.rs)  flowAfter: []
step "consult-readiness" (src/main.rs)    flowAfter: ["expose-readiness"]
step "readiness-test"    (tests/health.rs) flowAfter: ["expose-readiness"]
```

Cycles are rejected, and every identifier in `flowAfter` must name another step in the same walkthrough.
