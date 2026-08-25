# Security policy

Agent CodeWalk reads source locations, records a local pre-task baseline, accepts
agent-authored explanations, and updates user-level agent configuration during setup.
Those capabilities make path validation, protocol parsing, configuration ownership, and
local session confidentiality part of the security boundary.

## Supported versions

Before 1.0, security fixes are released for the latest published version only. Upgrade to
the newest Marketplace, Open VSX, or GitHub release before reporting a problem that may
already be fixed. If a newer release is not compatible with your editor, include that in
the report.

| Version | Security updates |
| --- | --- |
| Latest release | Supported |
| Earlier 0.x releases | Upgrade required |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include exploit details in a
public discussion. Use [GitHub private vulnerability reporting](https://github.com/andylin-hao/agent-codewalk/security/advisories/new).

Include as much of the following as you can:

- affected Agent CodeWalk, editor, operating-system, and agent versions
- whether the extension came from the Visual Studio Marketplace, Open VSX, a GitHub VSIX,
  or a local build
- clear reproduction steps or a minimal repository
- the expected and actual result
- whether the issue can read outside the workspace, write unowned configuration, execute
  code, expose local session content, or corrupt MCP protocol output
- logs with secrets, usernames, home-directory paths, repository names, and source text
  removed
- any suggested mitigation or patch

We aim to acknowledge a complete report within five business days. We will validate the
impact, coordinate a fix and release, and agree on disclosure timing with the reporter.
Please allow maintainers a reasonable remediation window before publishing details.

## Security boundaries

The following areas are treated as security-sensitive:

- **Workspace confinement.** Session paths must remain under the canonical workspace
  root. Absolute paths, `..` traversal, and symlink escapes are rejected.
- **Protocol integrity.** MCP stdout contains protocol messages only. Diagnostics go to
  stderr, and unknown or malformed input is rejected at Rust and TypeScript boundaries.
- **Untrusted explanations.** Agent-authored titles and explanations are text, not trusted
  HTML or executable content. Webview interpolation is escaped, messages are parsed from
  `unknown`, and the page uses a restrictive content security policy with a cryptographic
  nonce.
- **Configuration ownership.** Setup previews its write set, creates backups, refuses to
  replace unowned integrations, and rolls back failed transactions. Removal deletes only
  owned skills, adapters, hooks, and MCP entries that still reference the installed
  companion.
- **Session confidentiality.** Walkthroughs and baselines are local user data. The product
  has no telemetry, network client, or model API integration.
- **Update integrity.** Release VSIX files are built by GitHub Actions, attached to the
  GitHub release with SHA-256 checksums, and published from the same artifacts to both
  extension registries. GitHub build provenance is attached to release artifacts.

## Data stored locally

A published session contains workspace-relative paths, titles, explanations, line ranges,
normalized code hashes, dependency relationships, and up to 4,000 characters of replaced
text per step when a before/after comparison is possible. It does not store complete
source files as part of the walkthrough.

An unpublished task baseline may temporarily snapshot the minimum file content needed to
separate pre-existing worktree changes from the agent's task. Successful publication or
`abort_task` removes that task baseline. Published sessions remain until the user deletes
them; removing agent integrations intentionally does not delete session data.

The default data directories are:

| Platform | Directory |
| --- | --- |
| Linux | `$XDG_DATA_HOME/agent-codewalk` or `~/.local/share/agent-codewalk` |
| macOS | `~/Library/Application Support/agent-codewalk` |
| Windows | `%LOCALAPPDATA%\agent-codewalk` |

`AGENT_CODEWALK_HOME` or the `agentCodeWalk.storagePath` setting can override this location.

## Out of scope

- Vulnerabilities in Codex, Claude Code, OpenCode, VS Code, Cursor, VSCodium, Git, or the
  operating system that do not arise from Agent CodeWalk behavior
- Social engineering, denial of service requiring control of the user's account, or
  reports based only on automated scanner output without a reproducible impact
- Agent explanations that are inaccurate but remain inert text and do not bypass a
  security boundary

Even when a report is out of scope, clear evidence of a defense-in-depth improvement is
welcome as a normal issue or pull request after sensitive details are removed.
