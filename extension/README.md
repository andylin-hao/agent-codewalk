# Agent CodeWalk

Review code changes made by Codex, Claude Code, and OpenCode as a guided walkthrough inside VS Code or Cursor.

- Step through every explained code block with theme-aware highlighting, from the sidebar, a code lens, the status bar, or the keyboard.
- Switch between file order and execution-flow order.
- Compare a step with the code it replaced, without leaving the walkthrough.
- Detect stale or ambiguously moved code instead of opening the wrong range.
- Keep code and explanations local; no additional model API or API key is required.

## Getting started

1. Run **Agent CodeWalk: Setup Agent Integrations**. It shows every file it will touch before touching it.
2. Restart active agent sessions so they load the MCP server.
3. Ask Codex, Claude Code, or OpenCode to change code as usual.
4. When it reports that it is done, open the Agent CodeWalk view, or accept the notification.

| Action | Shortcut |
| --- | --- |
| Next step | `Alt+]` |
| Previous step | `Alt+[` |
| Switch order | `Alt+\` |
| Jump to a step | `Ctrl+Alt+W` (`Cmd+Alt+W` on macOS) |

**Agent CodeWalk: Diagnose Installation** asks each agent which MCP servers it actually loads, which is the fastest way to find out why nothing appeared.

The interface is available in English and Simplified Chinese.

See the project README for architecture, privacy behavior, limitations, and development instructions.
