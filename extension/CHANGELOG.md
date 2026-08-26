# Changelog

Notable user-visible changes are listed here. Versions follow the extension manifest; the
same release artifacts are published to the Visual Studio Marketplace, Open VSX, and
GitHub Releases.

## Unreleased

- Open Agent CodeWalk from the Secondary Side Bar, beside the agent that produced the
  walkthrough. VS Code keeps that bar hidden until it is opened, and a hidden bar has no
  container switcher, so on a fresh install the icon appeared to be missing entirely. The
  documentation now says so and gives the shortcut that reveals it, and both the
  publication notification and **Open Latest Walkthrough** open the bar for you, so
  neither depends on finding an icon first.
- Keep **Open Latest Walkthrough** working when the view cannot be revealed. Focusing the
  container was attempted first and thrown from, so on a build that cannot host it the
  command reported an error instead of playing the walkthrough.
- Replace the generic code-lines-and-arrow icon with an original open-frame mark whose
  three connected waypoints represent a guided path through code. The Marketplace icon
  gains a crisp cyan-and-violet identity, while the matching sidebar SVG remains
  monochrome and theme-aware at small sizes.
- Rebuild the project and Marketplace documentation around a visual product introduction,
  direct installation paths, a complete first-run flow, realistic usage examples, privacy
  details, settings, compatibility, and troubleshooting. The repository README now has a
  matching professional Simplified Chinese edition.
- Complete the contributor, agent, architecture, security, support, roadmap, publishing,
  and release-acceptance documentation so code and release changes have one explicit
  contract to follow.
- Build every platform VSIX on a tag and publish the GitHub release with checksums and
  build provenance. Registry uploads are manual, so the workflow holds no credentials and
  a tag can neither fail on a missing secret nor reach a public registry.
- Build the macOS Intel package by cross-compiling on Apple silicon. GitHub retired the
  macOS 13 image, and a job requesting a retired runner queues indefinitely rather than
  failing, which left the whole release pending.

## 0.7.3

- **The expansion arrow reads at a glance.** It was a small, low-contrast glyph that
  swapped between two characters; it is now a single chevron that turns, at the editor's
  icon colour and full row size, with a hover and focus state. The rotation is driven by
  `aria-expanded`, so what the reader sees and what a screen reader is told come from one
  value and cannot drift apart.

## 0.7.2

- **A second click folds a step away.** Clicking the step already in front of you now
  closes it instead of doing nothing, so one gesture both opens and closes a level. Only
  a click behaves this way: a code lens, the search, and the step commands still reveal
  and never fold, because collapsing something the reader was not looking at would undo
  work they did not ask about.

## 0.7.1

- **Clicking a step now opens its detail.** Selecting a parent revealed its ancestors but
  not its own children, so a click on a top-level row appeared to do nothing. Choosing a
  step is the same intent as reading on, and `next` already opened it; the two now agree.
  The triangle remains the way to fold a step away again.
- **The by-file list gained the same disclosure control.** It hid a collapsed subtree
  exactly like the graph but offered no way to open one, so a reader who switched views
  saw a shortened list with no explanation and no control.

## 0.7.0

### A stale companion says so

- Each session now records the companion version that published it, and the sidebar warns
  when that is behind the installed extension. An agent keeps the companion process it
  started with, so installing a new release does not update what a running session
  publishes through — the walkthrough simply arrives without the newer features, which
  reads as a broken feature rather than an agent that needs restarting.
- **Diagnose Installation** reports the version the extension ships, which is the number
  the warning compares against.
- `companionVersion` is an optional addition to the schema, so earlier sessions still
  load and produce no warning.

## 0.6.1

- **Next now opens a step instead of stepping over it.** Reading on through a closed
  parent reveals its detail rather than jumping to the next sibling, so every level is
  reachable from the keyboard alone. Previously anything below `initialDepth` could only
  be reached with a mouse, which made deep walkthroughs unreadable by their main control.

## 0.6.0

### Nested walkthroughs

- A step may now name another as its `parentId`, so a walkthrough arrives as a handful of
  top-level steps carrying the overall flow, each opening into the detail beneath it. A
  fifty-step change is no longer a fifty-row list.
- Nesting is arbitrarily deep by design, capped at eight levels as a guard. Two levels is
  what the skill asks for and what `agentCodeWalk.initialDepth` opens by default.
- A step with children may omit its range and inherit the block of its first child in the
  same file, for a parent that is genuinely represented by the first thing under it.
- `flowAfter` may only name a sibling. Execution order is a property of one level, which
  is what keeps the graph readable instead of drawing edges across the whole walkthrough.
- `Alt+]` and `Alt+[` move between the steps you can see, so a closed subtree is skipped
  rather than walked. Selecting a step from search or a code lens reveals it.
- New **Expand All Steps** and **Collapse All Steps** commands, and a collapse control in
  the view title.

### One less view

- The flat execution-flow list is gone. The graph now shows that order one level at a
  time, with more information and a way to close what you are not reading, so the list
  had nothing left to offer. `Alt+\` toggles the graph and the by-file list.

### Protocol

- `parentId` and `depth` are optional additions to the step schema. Sessions published by
  0.5.x and earlier still load, as flat walkthroughs.

## 0.5.0

### Reading a change in place

- The lines a step actually changed are now highlighted inside the block, in their diff
  color, while the rest of the block stays neutral. Finding the change no longer means
  opening the comparison, which stays available as **Compare with before**.
- A step's dot is a dot again. It carried the badge classes for its color and inherited
  their padding and border with it, which drew an empty capsule wherever a dot appeared
  outside the step list.

### Graph

- The graph is a vertical rail: one step per row with the full width for its title, and
  dependencies drawn as lanes down a left gutter. The previous layered layout put every
  independent step on one row, which was legible at six steps and unreadable at fifty.
- A lane is reused as soon as nothing depends on the step holding it, so a straight chain
  stays a single line and the gutter only widens where the work actually branches.
- **Flow** is the default view, and the flat execution-flow list it names is unchanged.
  It reads the same at any size, which the graph cannot promise.

## 0.4.0

### Workflow graph

- A third view in the sidebar draws the execution-flow order as a graph instead of a
  list. Steps that share a row have no dependency between them; every line points down
  to what depends on it, and every node opens its step. `Alt+\` now cycles the three
  views rather than toggling two.
- The current step's explanation sits directly under the navigation controls. The
  walkthrough summary moved below it into a collapsed **Walkthrough overview**, because
  the block being read is what the reader came for.

### Explanation quality

- The skill and the MCP server instructions now set how a walkthrough is written: one
  idea per step, 5 to 25 lines per range and 40 at the most, three or four sentences
  covering what the block does, why, and what depends on it.
- Every step of a change walkthrough must state the reason for the change, not only what
  changed.
- Explanations are written in the language the user is writing in, following that
  language's own conventions.

## 0.3.0

### Explanation walkthroughs

- A walkthrough no longer has to be about a change. Ask an agent to analyze, explain,
  review, or trace existing code and it can publish an explanation you step through with
  each block highlighted, instead of prose that names line numbers you have to find.
- New `publish_explanation` MCP tool. It needs no `begin_task`, no baseline, and no
  coverage validation, but every step must point at code that exists right now.
- A step of a change walkthrough may now point at code the task did not touch, when the
  reader needs it to follow the change. It is recorded as `context` and highlighted more
  quietly than a diff.
- The sidebar marks an explanation, labels step badges in the editor's language, and
  distinguishes both kinds in the session picker.
- The skill, the MCP server instructions, and the prompt reminder all describe both
  paths and when to choose each.

### Protocol

- `kind` (`change` or `explanation`) is now a required walkthrough field, and
  `changeKind` accepts `context`. Sessions published by 0.2.x are not readable by 0.3.0.
- An explanation may not carry changed hunks, uncovered hunks, a degraded baseline,
  replaced text, or an unavailable target. Six negative fixtures enforce it in both
  languages.

## 0.2.0

### Walkthrough view

- Redesign the sidebar: progress bar, a segmented control for file or execution-flow
  order, a current-step card with a change-kind badge, and a list of every step grouped
  by file.
- Add keyboard shortcuts for next (`Alt+]`), previous (`Alt+[`), order switching
  (`Alt+\`), and jump to step (`Ctrl+Alt+W`).
- Add a code lens on each explained block, a status bar entry, and a searchable
  jump-to-step picker.
- Notify when an agent publishes a walkthrough. Turn it off with
  `agentCodeWalk.notifyOnPublish`.
- Add a per-step diff against the lines the step replaced.
- Mark the other steps of the open file with a quieter decoration.
- Translate the interface into Simplified Chinese; it follows the editor language.

### Correctness

- Identify a workspace by its Git repository root. An agent started in a subdirectory
  previously published sessions the editor never found. `AGENT_CODEWALK_WORKSPACE`
  overrides it.
- Detect a new walkthrough by watching the data directory; the poll is now a fallback.
- Report unexplained hunks on a degraded baseline as `uncoveredHunks` instead of
  skipping validation silently.
- Fix agent detection: Claude Code was reported as installed for every user, because
  its marker was the directory containing `~/.claude.json`.
- Generate the webview nonce from a cryptographic source, and escape the message table
  embedded in the page script.
- Reject unknown fields in published protocol types.

### Diagnostics

- `Diagnose Installation` now asks each agent which MCP servers it loads.
- Add `scripts/verify-agent-install.mjs` for the same check from a terminal.
- Send the full workflow as MCP `initialize` instructions, so agents that do not load
  skills from a shared directory still receive it.

### Protocol

- `uncoveredHunks` (required) and `step.previousText` (optional) are added to
  walkthrough v1. Sessions published by 0.1.x are not readable by 0.2.0.

## 0.1.1

- Fix the production bundle so `jsonc-parser` has no unresolved internal modules.
- Force Remote SSH and WSL installations to run in the workspace extension host.
- Add a standalone bundle-load regression test to the package pipeline.

## 0.1.0

- Add local MCP task baselines and complete diff-hunk coverage validation.
- Add VS Code/Cursor walkthrough playback, code highlighting, and file/flow ordering.
- Add one-command Codex, Claude Code, and OpenCode integration setup and removal.
