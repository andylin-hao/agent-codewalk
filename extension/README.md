# Agent CodeWalk

Read what Codex, Claude Code, and OpenCode did — or explained — as a guided walkthrough inside VS Code or Cursor.

- **After a change**: step through every modified block, in file order or in the order the code runs.
- **After a question**: ask an agent to analyze, explain, review, or trace existing code, and step through its answer with each block highlighted instead of hunting for the line numbers it mentioned.
- Step through from the sidebar, a code lens, the status bar, or the keyboard, with theme-aware highlighting.
- Read a change as a handful of high-level steps, opening each one into the detail beneath it, on a clickable rail that draws every step's dependencies as lanes.
- Or group every step by file, when you want the whole list at once.
- See the lines a step changed highlighted inside the block, without opening a comparison.
- Compare a step with the code it replaced, without leaving the walkthrough.
- Detect stale or ambiguously moved code instead of opening the wrong range.
- Keep code and explanations local; no additional model API or API key is required.

## Getting started

1. Run **Agent CodeWalk: Setup Agent Integrations**. It shows every file it will touch before touching it.
2. Restart active agent sessions so they load the MCP server.
3. Ask Codex, Claude Code, or OpenCode to change code, or to explain how something works.
4. When it reports that it is done, open the Agent CodeWalk view, or accept the notification.

| Action | Shortcut |
| --- | --- |
| Next step | `Alt+]` |
| Previous step | `Alt+[` |
| Switch view | `Alt+\` |
| Jump to a step | `Ctrl+Alt+W` (`Cmd+Alt+W` on macOS) |

**Agent CodeWalk: Diagnose Installation** asks each agent which MCP servers it actually loads, which is the fastest way to find out why nothing appeared.

The interface is available in English and Simplified Chinese.

See the project README for architecture, privacy behavior, limitations, and development instructions.
