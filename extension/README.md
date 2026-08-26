<p align="center">
  <img src="https://raw.githubusercontent.com/andylin-hao/agent-codewalk/main/extension/media/icon.png" width="96" alt="Agent CodeWalk logo">
</p>

<h1 align="center">Agent CodeWalk</h1>

<p align="center">
  Turn an AI agent's work into a guided tour of the code—one meaningful block at a time.
</p>

<p align="center">
  <a href="https://github.com/andylin-hao/agent-codewalk/blob/main/README.md">English</a> ·
  <a href="https://github.com/andylin-hao/agent-codewalk/blob/main/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/andylin-hao/agent-codewalk">GitHub</a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=agent-codewalk.agent-codewalk"><img alt="Visual Studio Marketplace version" src="https://img.shields.io/visual-studio-marketplace/v/agent-codewalk.agent-codewalk?style=flat-square&label=VS%20Marketplace"></a>
  <a href="https://open-vsx.org/extension/agent-codewalk/agent-codewalk"><img alt="Open VSX version" src="https://img.shields.io/open-vsx/v/agent-codewalk/agent-codewalk?style=flat-square&label=Open%20VSX"></a>
  <a href="https://github.com/andylin-hao/agent-codewalk/releases/latest"><img alt="Latest GitHub release" src="https://img.shields.io/github/v/release/andylin-hao/agent-codewalk?style=flat-square"></a>
  <a href="https://github.com/andylin-hao/agent-codewalk/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5c6ac4?style=flat-square"></a>
</p>

![Agent CodeWalk product preview](https://raw.githubusercontent.com/andylin-hao/agent-codewalk/main/extension/media/hero.png)

Agent CodeWalk lets you read what Codex, Claude Code, or OpenCode changed—or what it
explained—as a walkthrough inside VS Code, Cursor, VSCodium, and compatible desktop
editors. Every step opens the relevant file, highlights the exact block, and keeps the
agent's reasoning beside the code instead of leaving you to hunt through a chat
transcript.

No extra model, cloud service, or API key is required. The agent you already use creates
the explanation, and the baseline and walkthrough data stay on your machine.

## What you get

- A dependency graph for following the order code runs, plus a complete file-grouped view
- Nested high-level steps that open into focused implementation detail
- Theme-aware highlights for added, modified, deleted, renamed, and contextual code
- A before/after comparison for steps that replaced existing text
- CodeLens, status bar, keyboard, sidebar, and searchable step navigation
- Safe relocation when code moves, with an explicit stale state when the target is
  ambiguous
- English and Simplified Chinese interface text that follows the editor language

## Install

The easiest update path is a registry installation:

- [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=agent-codewalk.agent-codewalk)
- [Open VSX Registry](https://open-vsx.org/extension/agent-codewalk/agent-codewalk)

You can also install from a terminal:

```bash
# VS Code
code --install-extension agent-codewalk.agent-codewalk

# Cursor
cursor --install-extension agent-codewalk.agent-codewalk

# VSCodium
codium --install-extension agent-codewalk.agent-codewalk
```

Offline and pinned packages for Linux x64, Windows x64, macOS Intel, and macOS Apple
silicon are attached to every [GitHub release](https://github.com/andylin-hao/agent-codewalk/releases),
together with SHA-256 checksums.

## One-time agent setup

1. Run **Agent CodeWalk: Setup Agent Integrations** from the Command Palette.
2. Review the exact user-level files shown in the confirmation and choose **Install**.
3. Restart active Codex, Claude Code, or OpenCode sessions so they load the local MCP
   companion and skill.
4. Run **Agent CodeWalk: Diagnose Installation** if a walkthrough does not appear. The
   command asks each agent which MCP servers it actually loaded.

Setup creates backups, rolls back a failed agent integration, and refuses to overwrite a
skill or MCP entry it does not own. **Agent CodeWalk: Remove Agent Integrations** removes
only owned resources and keeps published walkthroughs.

## Use it naturally

Ask your agent to change code as usual:

```text
Add retry handling to the upload path and cover the failure cases.
```

The agent records a baseline before its first edit and publishes a walkthrough after it
verifies the task. The local companion checks the real diff and requires every text hunk
to be covered.

Or ask it to explain existing code without making a change:

```text
Trace how a published walkthrough reaches the sidebar.
```

An explanation walkthrough needs no baseline, but every step must still point at code
that exists now.

## Navigate

Agent CodeWalk is reachable from either side, showing the same step in both:

- **Activity Bar**, on the left, beside your other extensions.
- **Secondary Side Bar**, on the right, beside the agent that produced the walkthrough.

**VS Code keeps the Secondary Side Bar hidden until you open it**, and a hidden bar has no
icons at all. Open it with `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS), or **View → Appearance →
Secondary Side Bar**, and the Agent CodeWalk icon appears in the switcher along its top
edge.

You never have to find an icon, though: accept the publication notification, or run
**Agent CodeWalk: Open Latest Walkthrough**. Either opens a panel for you.

| Action | Shortcut |
| --- | --- |
| Next visible step | `Alt+]` |
| Previous visible step | `Alt+[` |
| Switch graph/file view | `Alt+\` |
| Jump to any step | `Ctrl+Alt+W` (`Cmd+Alt+W` on macOS) |

The current step also appears as a CodeLens above its block and as progress in the status
bar. Select **Compare with before** when a modified step has baseline text available.

## Local-first and private

Agent CodeWalk includes no telemetry, makes no network requests, and does not call a
model API. The Rust companion communicates over standard input/output and never listens
on a port. Sessions keep paths, explanations, ranges, hashes, and a bounded amount of
replaced text for step comparison; they do not copy whole source files.

Read the complete [privacy and security model](https://github.com/andylin-hao/agent-codewalk/blob/main/SECURITY.md),
[architecture](https://github.com/andylin-hao/agent-codewalk/blob/main/docs/architecture.md),
and [troubleshooting guide](https://github.com/andylin-hao/agent-codewalk/blob/main/docs/troubleshooting.md)
in the project repository.

## Requirements

- Desktop VS Code 1.106 or newer, or a compatible Cursor/VSCodium build with Secondary
  Side Bar view containers
- Codex, Claude Code, or OpenCode installed before running integration setup
- A platform package matching the machine that runs the extension host

Browser-hosted editors cannot start the local companion. Remote SSH and WSL are
supported by installing the matching package in the workspace extension host.

Agent CodeWalk is open source under the
[MIT License](https://github.com/andylin-hao/agent-codewalk/blob/main/LICENSE).
