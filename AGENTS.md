# AGENTS.md

This file is the operating contract for coding agents working in Agent CodeWalk. Read it
before changing the repository. Human contributors should also read
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Product intent

Agent CodeWalk is a local-first VS Code/Cursor extension paired with a Rust MCP companion.
It turns an agent's code change or code explanation into a navigable walkthrough whose
steps open and highlight real source blocks in the editor.

Protect these product promises in every change:

- Walkthroughs are trustworthy: a normal change walkthrough covers every text diff hunk.
- Navigation is safe: stale or ambiguous anchors never highlight a guessed location.
- User code and explanations stay local unless a separately approved design says otherwise.
- Integration setup is transparent, reversible, and limited to resources the extension owns.
- The editor and companion agree on one versioned walkthrough contract.
- User-facing behavior is understandable in both English and Simplified Chinese.

Do not add telemetry, network access, model API calls, or remote content loading without a
separate user-approved design and an explicit privacy and security update.

## Repository map

| Area | Responsibility |
| --- | --- |
| `protocol/walkthrough-v1.schema.json` | Canonical persisted-session contract |
| `protocol/fixtures/` | Shared positive and negative protocol examples |
| `crates/agent-codewalk-mcp/` | Rust MCP transport, baseline capture, diff coverage, validation, and atomic publication |
| `extension/src/` | VS Code activation, storage, validation, navigation, highlighting, webview, localization, and integration setup |
| `extension/resources/agent-codewalk/SKILL.md` | Portable instructions installed for supported agents |
| `extension/package.json` and `package.nls*.json` | Marketplace metadata, commands, settings, keybindings, and localized manifest text |
| `scripts/` | Cross-project version synchronization and integration diagnostics |
| `.github/workflows/` | CI, pull-request policy, platform packaging, registry publishing, and GitHub releases |
| `docs/` | Architecture, troubleshooting, publishing, release acceptance, and roadmap |

## Shared contract rule

The JSON Schema is the source of truth for persisted walkthrough sessions. A schema or
semantic protocol change is incomplete until all affected layers move together:

1. Update `protocol/walkthrough-v1.schema.json`.
2. Update Rust request/session models, service validation, and MCP tool schemas.
3. Update TypeScript types, boundary validation, storage, and UI consumers.
4. Add or change shared fixtures, including a negative case for every new rejection rule.
5. Update Rust protocol tests and TypeScript validation tests.
6. Update the portable skill when agent input or sequencing changes.
7. Document compatibility and migration behavior in the README, architecture, and
   changelog.

Prefer backward-compatible optional fields while the schema version remains `1`. If a
consumer cannot safely interpret old data, make the incompatibility explicit and test the
failure message. Never silently coerce malformed persisted input.

## TypeScript standards

- Keep `strict` TypeScript enabled. Do not introduce `any`, unsafe casts, or unchecked
  index access to bypass a boundary.
- Give public APIs explicit parameter and return types and concise contract documentation.
- Parse `unknown` at extension, webview, command, configuration, and filesystem boundaries.
- Keep UI state derived from validated domain types. Do not let raw session JSON reach the
  player or webview.
- Dispose VS Code registrations, watchers, decorations, output channels, and timers
  explicitly and idempotently.
- Treat webview messages as untrusted input. Preserve CSP, nonce generation, HTML escaping,
  and the narrow message union.
- Add English and Simplified Chinese strings together. Manifest strings belong in both
  `package.nls.json` files; webview strings belong in `src/i18n.ts`.

## Rust standards

- Use safe Rust; workspace lints forbid `unsafe`.
- Keep Clippy's `all` and `pedantic` groups clean with warnings denied.
- Public functions returning `Result` need useful `# Errors` documentation.
- Validate identifiers, paths, ranges, hierarchy, flow graphs, and size limits before
  filesystem writes.
- Never write diagnostics to MCP stdout. Protocol messages use stdout; diagnostics use
  stderr.
- Keep ownership and cleanup explicit. Baseline deletion, abort, rollback, and publication
  must remain idempotent or atomic as their contracts require.
- Preserve canonical workspace resolution and reject absolute paths, `..` traversal, and
  symlink escapes.

## Installer and ownership rules

Integration code modifies user-level agent configuration, so it deserves the same care as
a migration tool.

- Show the full plan before writing anything.
- Back up existing configuration before an owned edit.
- Preserve comments, formatting, and unrelated settings where the format permits.
- Refuse to overwrite an unowned `agent-codewalk` MCP entry or skill.
- Roll back the current transaction after a failure.
- Remove only paths and entries recorded in the ownership manifest and still pointing to
  the installed companion.
- Keep uninstall separate from session deletion; published walkthroughs are user data.
- Test Codex, Claude Code, and OpenCode paths independently and together on path variants
  relevant to Windows, macOS, and Linux.

## User experience and accessibility

- Use plain, specific language. Errors must say what failed, name the relevant path or
  step when safe, and give the next action.
- Make keyboard and pointer behavior agree unless there is a documented reason they
  should differ.
- Maintain visible focus, semantic roles, `aria-*` state, theme colors, and adequate
  contrast in the webview.
- Never encode meaning by color alone. Badges, labels, and notices must carry the same
  information.
- A stale target is a normal safe state, not permission to open the nearest-looking code.
- Update tests and user documentation for every user-facing change.

## Documentation standards

- Keep `README.md` and `README.zh-CN.md` equivalent in substance and section order.
- Keep `extension/README.md` concise and marketplace-focused; link to deeper repository
  documents instead of duplicating maintainer material.
- Verify commands, settings, versions, platform asset names, file paths, and limits against
  the code before documenting them.
- Prefer examples that describe a real workflow. Avoid hype that the implementation cannot
  support.
- Update `extension/CHANGELOG.md` for user-visible behavior, not internal refactoring.
- Update `docs/architecture.md` when ownership, data flow, trust boundaries, or storage
  changes.
- Update `docs/publishing.md` and `docs/release-checklist.md` when distribution automation
  changes.
- Keep relative links valid from the file that contains them. Marketplace copy should use
  stable absolute repository links for files outside the packaged extension.

## Tests and required verification

Choose focused tests while iterating, then run the full gates before handing off a change:

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

Run the real extension-host suite for editor behavior or before a release. It requires a
display; CI uses `xvfb-run` on Linux:

```bash
corepack pnpm --filter agent-codewalk test:extension
```

When changing installation paths or agent configuration, also run:

```bash
node scripts/verify-agent-install.mjs
```

That script asks each available agent what it actually loads. A generated configuration
file alone is not proof that an integration works.

Do not report a gate as passing unless you ran it. If the environment cannot run a gate,
state the exact limitation and leave reproducible instructions.

## Change workflow

1. Inspect the current implementation and nearby tests before editing.
2. Keep a change focused; do not mix unrelated cleanup into the task.
3. Add or update tests with the implementation.
4. Update every affected user and maintainer document.
5. Run focused checks, then the complete required verification.
6. Review the final diff for accidental generated files, stale links, secrets, and
   protocol drift.

Use Conventional Commits with an imperative, lowercase description and a required scope:

```text
feat(player): reveal nested steps during navigation
docs(readme): clarify marketplace installation
```

Sign every commit with `git commit -s` so it includes `Signed-off-by:`. Pull-request titles
follow the same convention and should stay within the repository's policy limit.
