# Release checklist

Use this checklist for every public Agent CodeWalk release. Automated checks protect the
protocol and implementation; they cannot prove that a registry listing is correct, a real
agent loaded the companion, or an owned uninstall preserved unrelated user configuration.

Record the operator, date, target version, tested editors, operating systems, agents, and
links to evidence in the release pull request.

## Release metadata

- [ ] Version: `__________`
- [ ] Release pull request: `__________`
- [ ] Release owner: `__________`
- [ ] Verification date: `__________`
- [ ] Visual Studio Marketplace publisher access confirmed
- [ ] Open VSX namespace access confirmed
- [ ] GitHub Actions `VSCE_PAT` and `OVSX_PAT` secrets present and current

## Source and documentation

- [ ] The root `package.json` contains the intended version.
- [ ] `node scripts/sync-version.mjs --check` reports the same version in the extension,
  Cargo workspace, and installer.
- [ ] `Cargo.lock` records the current workspace crate version.
- [ ] `extension/CHANGELOG.md` starts with a user-focused entry for this release.
- [ ] `README.md` and `README.zh-CN.md` describe the same shipped behavior.
- [ ] `extension/README.md` renders correctly as the Marketplace/Open VSX listing.
- [ ] The icon, product figure, badges, headings, tables, alt text, and internal links render
  correctly on GitHub.
- [ ] Installation commands, setting names, keybindings, platform assets, and current
  limits match the code.
- [ ] Architecture, troubleshooting, publishing, security, support, contributing, agent
  instructions, and roadmap are updated where the release changes their contract.
- [ ] Repository, homepage, bug, license, security, and support links use the canonical
  `andylin-hao/agent-codewalk` location.

## Automated quality gates

- [ ] `corepack pnpm install --frozen-lockfile`
- [ ] `node scripts/sync-version.mjs --check`
- [ ] `corepack pnpm --filter agent-codewalk check`
- [ ] `corepack pnpm --filter agent-codewalk test`
- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace`
- [ ] `corepack pnpm --filter agent-codewalk build`
- [ ] `corepack pnpm --filter agent-codewalk package`
- [ ] `corepack pnpm --filter agent-codewalk test:extension` in a displayed environment
- [ ] CI extension, Rust matrix, Rust coverage, and dependency audit jobs are green.
- [ ] Pull-request policy accepts the signed release commit and title.

## Local package inspection

- [ ] The VSIX packages without `--allow-missing-repository` or other bypass flags.
- [ ] `vsce ls --tree` contains one production bundle, `media/icon.png`,
  `media/hero.png`, `README.md`, `CHANGELOG.md`, `LICENSE`, the portable skill, and exactly
  one companion executable.
- [ ] The VSIX does not contain source maps with private paths, test fixtures, task
  baselines, credentials, unrelated build outputs, or another platform's companion.
- [ ] The packaged manifest reports the expected extension ID, version, VS Code engine,
  extension kind, repository, categories, commands, settings, and target platform.
- [ ] The staged companion runs and reports the same version as the extension.
- [ ] The packaged extension bundle passes the standalone smoke-load check.

## Tag and GitHub release

- [ ] The release commit uses Conventional Commits and contains `Signed-off-by:`.
- [ ] The annotated `v<version>` tag is signed and points at that commit.
- [ ] The tag-triggered release workflow builds all four targets:
  - [ ] `linux-x64`
  - [ ] `win32-x64`
  - [ ] `darwin-x64`
  - [ ] `darwin-arm64`
- [ ] The GitHub release contains all four VSIX files and `SHA256SUMS`.
- [ ] GitHub build provenance covers every VSIX.
- [ ] Downloaded artifacts pass `sha256sum -c SHA256SUMS`.
- [ ] Generated release notes are edited for clarity and contain no secrets or internal
  filesystem paths.

## Registry publication

### Visual Studio Marketplace

- [ ] The release workflow uploaded the exact GitHub VSIX artifacts, not a second build.
- [ ] The listing shows the new version for all four supported targets.
- [ ] The logo, product figure, English copy, links, changelog, and license render correctly.
- [ ] Searching **Agent CodeWalk** finds publisher `agent-codewalk`.
- [ ] A clean VS Code profile installs `agent-codewalk.agent-codewalk` from the listing.

### Open VSX

- [ ] The release workflow uploaded the exact GitHub VSIX artifacts.
- [ ] The owned `agent-codewalk` namespace shows the new version for all four targets.
- [ ] The logo, product figure, README, links, changelog, and license render correctly.
- [ ] Searching **Agent CodeWalk** finds the extension in a clean VSCodium profile.
- [ ] VSCodium installs `agent-codewalk.agent-codewalk` from Open VSX.

Do not mark the release complete if either registry is missing. Follow
[publishing.md](publishing.md) for credential failure, registry retry, and patch-release
rules.

## Clean-profile installation matrix

Test the package on the machine that runs each extension host. Remote SSH and WSL normally
use the Linux package even when the local desktop runs another OS.

| Host | Registry or asset | Editor | Result |
| --- | --- | --- | --- |
| Linux x64 | Marketplace / Open VSX / GitHub | `__________` | `__________` |
| Windows x64 | Marketplace / GitHub | `__________` | `__________` |
| macOS Intel | Marketplace / GitHub | `__________` | `__________` |
| macOS Apple silicon | Marketplace / GitHub | `__________` | `__________` |
| Remote SSH or WSL | Linux VSIX in workspace host | `__________` | `__________` |

For each representative install:

- [ ] The extension activates without an error and shows its icon in the right-hand
  Secondary Side Bar container switcher.
- [ ] The listing description and editor UI follow the selected language.
- [ ] The packaged companion exists, is executable, and matches the host platform.
- [ ] Installing from a registry follows its update path.
- [ ] Installing from VSIX succeeds and the manual-update limitation is clear.

## First-run agent integration

Test from a clean or disposable user profile. Do not risk a maintainer's real agent
configuration.

- [ ] **Setup Agent Integrations** lists every path before writing.
- [ ] Canceling the confirmation leaves all paths untouched.
- [ ] Setup detects only agents present in the test profile.
- [ ] Existing configuration receives `.agent-codewalk.bak` backups.
- [ ] Comments, formatting, and unrelated MCP servers/hooks survive owned edits.
- [ ] An unowned same-name skill or MCP entry is refused and that agent rolls back.
- [ ] A failure in one agent does not undo a successful different agent.
- [ ] Running setup twice is idempotent.
- [ ] `node scripts/verify-agent-install.mjs` reports every available agent as loading the
  companion.
- [ ] **Diagnose Installation** reports version, executable, config, owned skill, and real
  MCP visibility clearly.
- [ ] Restart guidance appears after setup and a restarted agent loads the current
  companion.

## Change walkthrough acceptance

- [ ] In a Git repository with a pre-existing dirty file, ask an agent to change at least
  two other files and modify existing text.
- [ ] The agent calls `begin_task` before its first mutation and `publish_walkthrough` only
  after verification.
- [ ] Pre-existing changes are not attributed to the task.
- [ ] Publication refuses an intentionally uncovered text hunk.
- [ ] The completed walkthrough opens in the right-hand Secondary Side Bar from its icon,
  the notification, and the **Open Latest Walkthrough** command.
- [ ] Nested steps expand and collapse by pointer and keyboard.
- [ ] `Alt+]`, `Alt+[`, `Alt+\`, and the jump shortcut work.
- [ ] Dependency graph and file views show the same steps and preserve the active step.
- [ ] CodeLens, status bar, current-step card, progress, and in-editor highlight agree.
- [ ] Modified lines are distinct inside the anchored block without relying on color alone.
- [ ] **Compare with before** opens the correct bounded diff.
- [ ] A purely added step explains why no previous text is available.
- [ ] Moving the block to one unique location relocates it and reports that fact.
- [ ] Duplicating or changing the block produces stale state and no guessed highlight.

## Explanation walkthrough acceptance

- [ ] Ask the agent to explain or trace existing code without modifying files.
- [ ] It calls `publish_explanation` without `begin_task`.
- [ ] The walkthrough is labeled as an explanation and uses neutral context highlights.
- [ ] Every step opens current code and no before/after diff is offered.
- [ ] A missing or invalid current range is rejected at publication.
- [ ] A general non-code configuration question stays in chat and publishes nothing.

## Degraded and excluded paths

- [ ] Publishing a change without `begin_task` creates an explicit degraded session.
- [ ] Uncovered inferred hunks are listed in the sidebar rather than silently omitted.
- [ ] Binary, oversized, generated, submodule, and non-UTF-8 changes appear with reasons in
  `excludedChanges`.
- [ ] An agent started in a repository subdirectory publishes a session visible from the
  repository root and that subdirectory.
- [ ] A completely deleted target retains its explanation and is marked unavailable.
- [ ] A session from an older companion displays restart guidance when appropriate.

## Removal and data retention

- [ ] **Remove Agent Integrations** previews and confirms the destructive scope.
- [ ] Owned MCP entries, skills, hooks, manifest, and companion are removed.
- [ ] Unrelated configuration and unowned same-name resources survive.
- [ ] Published walkthrough sessions remain available after integration removal.
- [ ] **Delete Walkthrough** removes only the active session after confirmation.
- [ ] Reinstall after removal succeeds cleanly.

## Final sign-off

- [ ] All blockers are fixed or explicitly moved to a new patch release; none are hidden in
  release notes.
- [ ] The release is visible and installable from the Visual Studio Marketplace, Open VSX,
  and GitHub Releases.
- [ ] Checksums and provenance are published.
- [ ] Support and security routes are working.
- [ ] The release announcement links to installation, usage, changelog, and known limits.
- [ ] Release owner: `__________`
- [ ] Maintainer reviewer: `__________`
