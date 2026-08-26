# Troubleshooting

Most Agent CodeWalk problems come from one of three boundaries: the editor extension is
installed in the wrong extension host, an existing agent session has not loaded the local
companion, or the published walkthrough belongs to a different workspace identity. Start
with the checks below before editing configuration by hand.

## Fast diagnostic path

1. Open the workspace where the agent performed the task.
2. Run **Agent CodeWalk: Diagnose Installation** from the Command Palette.
3. Open **View: Output** and select **Agent CodeWalk**.
4. Confirm that the output reports:
   - the extension and companion version you expect;
   - an executable companion path;
   - the agents configured by the last setup;
   - owned skills present; and
   - `agent-codewalk` listed by each available agent's real MCP command.
5. Restart the agent session after any setup, extension update, or companion-path change.

You can run the same agent visibility probe from the repository:

```bash
node scripts/verify-agent-install.mjs
```

The script skips agent CLIs that are not installed. A config file marked present does not
prove that a running agent loaded it; the MCP listing result is the important line.

## No walkthrough appears

### The Secondary Side Bar is hidden, so there is no icon to find

Agent CodeWalk appears in the Activity Bar on the left and in the switcher along the top
of the Secondary Side Bar on the right. VS Code keeps that right-hand bar hidden until it
is opened, and a hidden bar has no switcher, so the icon there is not merely hard to spot
— there is nowhere for it to be.

Press `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS) or run **View: Toggle Secondary Side Bar
Visibility**. Running **Agent CodeWalk: Open Latest Walkthrough** opens whichever panel is
available, which is the faster check that the extension loaded at all.

VS Code remembers layout changes, so run **View: Reset View Locations** if the container
was dragged elsewhere and you want it back on the right.

### The agent integration was never set up

Installing the VSIX adds the editor UI, but it does not silently edit agent configuration.
Run **Agent CodeWalk: Setup Agent Integrations**, review the planned user-level paths, and
choose **Install**.

Setup configures only agents it detects. If you installed Codex, Claude Code, or OpenCode
after the first setup, run the command again.

### The agent session is older than the installation

An agent keeps the MCP process it started with. Restart the complete agent session—not
only the editor tab—after setup or after updating Agent CodeWalk. A walkthrough published
by an older companion carries its version; the sidebar warns when it is behind the
installed extension.

### The task did not point at code

Agent CodeWalk publishes:

- a change walkthrough after an agent modifies files; or
- an explanation walkthrough when the user asks to analyze, explain, review, or trace
  existing code.

General advice such as “how should I configure this tool?” does not point at code and
should stay in the conversation rather than creating a walkthrough.

### The agent did not follow the installed skill

Use the diagnostic command to confirm the MCP server is visible, then confirm the skill
directory exists:

| Agent | Skill path |
| --- | --- |
| Codex | `~/.agents/skills/agent-codewalk/` |
| Claude Code | `~/.claude/skills/agent-codewalk/` |
| OpenCode | `~/.agents/skills/agent-codewalk/` |

If another file already occupied that path without the Agent CodeWalk ownership marker,
setup deliberately skipped the integration instead of overwriting it. Move or rename the
unowned skill only after reviewing it, then run setup again.

### The editor opened a different workspace

Sessions are keyed to the canonical workspace root. Open the Git repository—or a folder
inside that repository—in the same remote/local environment where the agent ran.

Local and Remote SSH paths are intentionally different identities. A session created by a
local agent will not be attached to an unrelated path on the remote host. For unusual
launchers, set `AGENT_CODEWALK_WORKSPACE` in the agent environment to the same canonical
root opened by the editor.

## Setup reports no installed agents

Agent detection looks for the agent executable and its normal user configuration paths.
Confirm that the relevant command works in the environment where the extension host runs:

```bash
codex --version
claude --version
opencode --version
```

On Remote SSH or WSL, an extension running in the workspace host sees the remote/WSL home
directory and executables, not the local desktop's. Install or configure the agent in that
same environment, then rerun setup.

## Setup skips one agent

Setup is transactional per agent. It can configure two agents successfully while skipping
a third whose config is malformed or whose same-name MCP entry/skill is not owned by Agent
CodeWalk. The final notification and output channel include the rejected path and reason.

Do not delete the conflicting entry blindly. Inspect it first. If it belongs to an older
manual Agent CodeWalk installation, remove that manual entry, preserve unrelated settings,
and run setup again. If it belongs to another tool, keep it and use a separate name rather
than asking Agent CodeWalk to take ownership.

Backups created by owned edits use the suffix `.agent-codewalk.bak` next to the original
configuration file.

## The sidebar says the companion is stale

The extension has been updated, but the publishing agent still uses the older companion
process it launched earlier. Restart the agent session. Rerunning setup is necessary only
when diagnostics show the installed companion itself is missing or has the wrong version.

Existing sessions remain readable when their schema is compatible; the warning describes
the process that published the new session, not corruption of older session files.

## A step is stale or does not highlight

The code moved or changed after publication. Agent CodeWalk first checks the original line
range, then searches the same file for one unique normalized code hash. If it finds zero
or multiple matches, it refuses to guess and marks the step stale.

Return the file to the published state, publish a fresh explanation, or ask the agent to
run a new task. A completely deleted target cannot be highlighted by design; its
explanation remains in the sidebar.

## Compare with before is unavailable

The comparison exists only when a change step replaced baseline text. There is nothing to
compare for:

- a purely added block;
- an explanation walkthrough;
- an unchanged context step; or
- a deleted target whose bounded previous text was unavailable.

The active highlight still shows the step whenever a current target exists.

## The walkthrough warns about a degraded baseline

The agent published without a successful `begin_task`, or the workspace did not provide a
complete Git baseline. The companion still validates the request and reports inferred
uncovered hunks, but it cannot guarantee that the displayed diff belongs only to the
current task.

For the next task, confirm the current skill is installed and restart the agent. In a
non-Git workspace, initialize Git if complete task-boundary coverage is important.

## Some changed files are excluded

Unsupported changes remain visible in `excludedChanges` with a reason. The companion does
not render binary files, Git submodules, generated files, non-UTF-8 text, or files larger
than 1 MiB as anchored code steps. This prevents unsafe decoding, excessive local
snapshots, and misleading text diffs.

The agent can still mention the effect in the walkthrough summary. If a text file was
classified incorrectly, include the file encoding, size, and diagnostic reason in a bug
report without attaching sensitive content.

## Remote SSH, WSL, Cursor, and VSCodium

- Install the package matching the machine that runs the workspace extension host.
- Linux Remote SSH hosts normally need `agent-codewalk-linux-x64.vsix`, even when the local
  desktop is Windows or macOS.
- The extension declares `workspace` kind so VS Code installs it where it can launch the
  companion and read workspace files.
- Browser-hosted editors cannot run the local executable and are not supported.
- Marketplace availability depends on the editor. VS Code and Cursor commonly use the
  Visual Studio Marketplace; VSCodium and other Code OSS builds commonly use Open VSX.

## VSIX installation issues

Download the asset matching the extension host and verify it before installation:

```bash
sha256sum -c SHA256SUMS
code --install-extension ./agent-codewalk-linux-x64.vsix
```

On macOS, use `shasum -a 256 <file>` if `sha256sum` is unavailable. GitHub release assets
are platform-specific; installing the wrong target can load the UI but leave no usable
companion binary.

Manual VSIX installations do not use the normal Marketplace auto-update path. Prefer the
Visual Studio Marketplace or Open VSX for routine installations.

## Reset or remove integrations

Run **Agent CodeWalk: Remove Agent Integrations**. The command removes the installed
companion, owned skills, owned lifecycle hooks, and MCP entries that still reference that
companion. It preserves unrelated agent configuration and published walkthrough sessions.

To delete a single published session, open it and run **Agent CodeWalk: Delete Walkthrough**.
To remove all local sessions, close active agents and the editor, locate the data directory
reported by **Diagnose Installation**, and back it up before deleting it manually.

## Collect useful logs for a bug report

Include:

- Agent CodeWalk, editor, OS, and agent versions
- local, WSL, container, or Remote SSH context
- installation channel and VSIX target, if applicable
- output from **Agent CodeWalk: Diagnose Installation**
- the shortest reliable reproduction and expected result
- whether the workspace uses Git and whether it had pre-existing changes

Remove API keys, tokens, usernames, home paths, repository names, source text, and agent
conversation content. For a suspected security issue, stop and follow the private process
in [SECURITY.md](../SECURITY.md).
