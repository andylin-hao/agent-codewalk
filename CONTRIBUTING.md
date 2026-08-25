# Contributing to Agent CodeWalk

Thank you for helping make agent-written code easier to understand. Agent CodeWalk spans
an editor extension, a local Rust MCP companion, and a shared persisted protocol, so the
best contributions are focused, tested across the boundary they touch, and written with
the user's local data and configuration in mind.

Before starting a substantial feature or protocol change, open an issue and describe the
problem, proposed behavior, compatibility impact, and privacy implications. Small fixes,
tests, and documentation improvements can go directly to a pull request.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security vulnerabilities should use the private process in [SECURITY.md](SECURITY.md),
not a public issue.

## Development prerequisites

- Git
- Node.js 20 or newer
- Corepack with pnpm 10
- Rust 1.85 or newer, including `rustfmt` and `clippy`
- A desktop VS Code-compatible editor for manual and extension-host testing
- Linux extension-host tests also need a display; CI uses Xvfb

Clone and bootstrap the workspace:

```bash
git clone https://github.com/andylin-hao/agent-codewalk.git
cd agent-codewalk
corepack enable
corepack pnpm install --frozen-lockfile
cargo build --workspace
```

## Repository structure

| Path | What lives there |
| --- | --- |
| `extension/src/` | Extension activation, playback, webview, storage, validation, localization, and integration setup |
| `extension/resources/agent-codewalk/SKILL.md` | Agent instructions bundled into every VSIX |
| `crates/agent-codewalk-mcp/` | Baseline capture, Git diffing, protocol validation, MCP transport, and session storage |
| `protocol/` | Walkthrough JSON Schema and cross-language fixtures |
| `scripts/` | Version synchronization and real-agent installation diagnostics |
| `docs/` | Architecture, support, publishing, release acceptance, and roadmap |
| `.github/workflows/` | CI, PR policy, release packaging, registry publication, and GitHub Releases |

Read [AGENTS.md](AGENTS.md) for the repository invariants and
[docs/architecture.md](docs/architecture.md) for the runtime data flow.

## A useful development loop

Run the smallest relevant test while working, then the complete suite before opening a
pull request.

```bash
# Type-check and lint the extension
corepack pnpm --filter agent-codewalk check

# Run extension unit tests with coverage and smoke-load the production bundle
corepack pnpm --filter agent-codewalk test

# Run one Vitest file while iterating
corepack pnpm --filter agent-codewalk exec vitest run src/player.test.ts

# Format and test the companion
cargo fmt --all
cargo test --workspace

# Run one Rust integration test target
cargo test -p agent-codewalk-mcp --test lifecycle
```

To build a production extension bundle:

```bash
corepack pnpm --filter agent-codewalk build
```

To build a local VSIX, compile the native companion first:

```bash
cargo build --release --locked
corepack pnpm --filter agent-codewalk package
```

The package command stages the platform companion, smoke-loads the bundle, and creates a
VSIX in `extension/`.

## Full quality gate

Run every command below before requesting review:

```bash
corepack pnpm install --frozen-lockfile
node scripts/sync-version.mjs --check
corepack pnpm --filter agent-codewalk check
corepack pnpm --filter agent-codewalk test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
corepack pnpm --filter agent-codewalk build
corepack pnpm --filter agent-codewalk package
```

For editor navigation, CodeLens, webview, status bar, or activation behavior, also run the
real extension-host suite:

```bash
corepack pnpm --filter agent-codewalk test:extension
```

On a headless Linux machine:

```bash
xvfb-run -a corepack pnpm --filter agent-codewalk test:extension
```

CI additionally measures Rust coverage, audits production dependencies, builds the Rust
workspace on Linux, Windows, and macOS, and enforces the pull-request title format.

## Changing the walkthrough protocol

`protocol/walkthrough-v1.schema.json` is the persisted-session source of truth. A protocol
change must update all consumers in the same pull request:

- JSON Schema and its positive/negative fixtures
- Rust request and session types, validation, service behavior, and MCP tool schemas
- TypeScript types, strict validation, storage, player, and webview behavior
- Rust and TypeScript contract tests
- the portable `SKILL.md` when agent inputs or sequencing change
- README, architecture, troubleshooting, and changelog where relevant

Add a negative fixture for each new boundary rule. Both Rust and TypeScript must reject it
for the same reason. Prefer optional, backward-compatible fields while the schema remains
version `1`; document any session incompatibility explicitly.

## Changing the extension

- Keep TypeScript strict and parse `unknown` at commands, webview messages, configuration,
  JSON, and filesystem boundaries.
- Register every VS Code resource in a disposable owner.
- Use VS Code theme colors and keep focus, keyboard navigation, semantic roles, and ARIA
  state intact.
- Add unit coverage for behavior and extension-host coverage where the real editor API is
  part of the contract.
- Add user-visible strings to both English and Simplified Chinese sources.
- Update the Marketplace README and changelog for user-visible changes.

`extension/src/test/vscode-mock.ts` is the typed unit-test double. Keep it intentionally
small; add only the editor surface required by a behavior test.

## Changing the companion

- Use safe Rust and keep Clippy clean with warnings denied.
- Document errors on public fallible APIs.
- Keep MCP stdout free of logs; use stderr for diagnostics.
- Reject invalid paths, ranges, graphs, and lifecycle states before writing.
- Preserve atomic session publication and idempotent task cleanup.
- Test with a real temporary Git repository when behavior depends on baseline, index, or
  worktree state.

## Changing agent integrations

Installer changes affect user configuration outside the workspace. Tests must cover:

- planning and confirmation before writes
- backup creation and preservation of unrelated content
- refusal to overwrite unowned entries or skills
- rollback after partial failure
- idempotent setup and owned-only removal
- Codex, Claude Code, and OpenCode individually and together
- platform-specific executable and configuration paths

After a manual setup, run:

```bash
node scripts/verify-agent-install.mjs
```

The script invokes each available agent's MCP listing command. A config file existing on
disk is not enough to prove the agent loaded it.

## Documentation and localization

Documentation is part of the feature, not follow-up work.

- Keep `README.md` and `README.zh-CN.md` equivalent in meaning and section order.
- Write for a reader who uses an editor but may not know MCP, VSIX, or extension-host
  terminology; explain those terms the first time they matter.
- Verify every command, setting, limit, platform asset, and path against the code.
- Use natural professional language and concrete examples. Do not promise unpublished or
  unimplemented behavior.
- Keep `extension/README.md` optimized for the extension listing and use absolute GitHub
  links for repository documents outside the VSIX.
- Check headings, tables, fenced blocks, image alt text, and relative links in both GitHub
  and the packaged extension preview.

## Commit and pull-request conventions

Create a focused branch from `main`. Commits and PR titles follow Conventional Commits,
require a scope, use an imperative lowercase description, and should stay concise:

```text
fix(installer): preserve existing opencode settings
docs(readme): explain open vsx installation
```

Sign every commit:

```bash
git commit -s -m "docs(readme): improve installation flow"
```

Your pull request should include:

- the user problem and resulting behavior
- important design or compatibility decisions
- privacy, security, or ownership impact
- tests added or changed
- the exact verification commands run and their results
- screenshots or a short recording for visible UI changes
- linked documentation and changelog updates

Keep unrelated refactors out of the same PR. Preserve current behavior unless the change
is explicitly named, documented, and tested.
