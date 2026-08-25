# Changelog

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
