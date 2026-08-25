# Support

Agent CodeWalk is a community-maintained open-source project. The fastest path to a useful
answer is to start with the [Troubleshooting guide](docs/troubleshooting.md), which covers
agent setup, stale companions, workspace discovery, Remote SSH/WSL, VSIX targets, and
local logs.

## Where to ask

- **Reproducible bug:** open a [GitHub issue](https://github.com/andylin-hao/agent-codewalk/issues/new).
- **Feature or workflow idea:** open an issue describing the user problem before proposing
  a specific implementation.
- **Implementation question:** start from [Architecture](docs/architecture.md) and
  [Contributing](CONTRIBUTING.md), then use an issue if the contract remains unclear.
- **Security vulnerability:** do not open an issue; use the private process in
  [SECURITY.md](SECURITY.md).
- **Code of Conduct concern:** use the private reporting route in
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Questions about Codex, Claude Code, OpenCode, VS Code, Cursor, or VSCodium behavior that
does not involve Agent CodeWalk should go to that project's support channel.

## Before opening a bug

1. Update to the latest Agent CodeWalk release.
2. Restart the complete agent session, especially after an extension update.
3. Run **Agent CodeWalk: Diagnose Installation** and inspect the Agent CodeWalk output
   channel.
4. Reproduce the problem in the smallest workspace you can safely share.
5. Search existing issues for the exact error or symptom.

## What to include

- Agent CodeWalk version and installation source
- editor name and version
- operating system and architecture
- local, Remote SSH, WSL, container, or other extension-host context
- agent name and version
- whether the workspace is a Git repository and had pre-existing changes
- exact steps, expected behavior, and actual behavior
- sanitized diagnostic output and a screenshot or short recording when the problem is
  visual

Never post API keys, access tokens, private source, complete agent conversations, usernames,
or sensitive filesystem paths. Replace them consistently so the remaining logs can still
be followed.

## Response expectations

Maintainers prioritize security issues, regressions that risk user configuration or data,
and bugs with a small reproduction. A clear report may still need time or community help;
opening an issue does not guarantee a delivery date. Focused pull requests are welcome
after the intended behavior is agreed.
