# Agent CodeWalk Roadmap to v1.0

Agent CodeWalk lets Codex, Claude Code, and OpenCode publish a navigable explanation of
the code they just changed, and lets a reader step through it inside VS Code or Cursor
with the relevant block highlighted.

This roadmap describes the work between the v0.1.1 prototype and a v1.0 that can be
installed by someone who has never seen the repository.

## Shape of the product

Three components, none of which is optional:

| Component | Why it exists |
| --- | --- |
| VS Code / Cursor extension | Only an extension host can open a document, highlight a range, and drive step navigation. |
| Local Rust MCP companion | The one protocol all three agents share. It records the pre-task baseline, computes the real diff, and refuses to publish a walkthrough that does not cover every changed hunk. |
| Portable `SKILL.md` | Tells an agent when to call the tools and how to write a step. One text reused by every agent. |

A skill alone cannot highlight code. An extension alone cannot know why a line changed.
The companion exists so that change coverage is derived from Git rather than trusted
from the agent's own report.

## Two kinds of walkthrough

A walkthrough is not only about a change. Since 0.3.0 there are two publication paths,
sharing one protocol, one player, and one interface:

- **Change** (`begin_task` → `publish_walkthrough`): what a task modified, validated
  against a recorded baseline so no changed hunk can go unexplained.
- **Explanation** (`publish_explanation`): a tour of code that was not modified,
  published when the user asks an agent to analyze, explain, review, or trace something.
  No baseline, no diff, no coverage validation — but every step must point at code that
  exists, and the execution-flow order is what carries the explanation.

A change walkthrough may also include `context` steps: unchanged code the reader needs
in order to follow the change, highlighted more quietly than a diff.

## Baseline: what v0.1.1 already does

- `begin_task` snapshots Git HEAD, the index, and any pre-existing dirty files.
- `publish_walkthrough` recomputes the diff and rejects publication while any text hunk
  lacks an overlapping step.
- Steps carry a normalized SHA-256 anchor, so a block that moved after publication is
  re-found when exactly one match exists, and reported stale otherwise.
- Two orders: by file position, and by execution flow through a validated acyclic
  `flowAfter` graph.
- One-command install, diagnose, and removal for Codex, Claude Code, and OpenCode, with
  backups, per-agent rollback, and refusal to overwrite files the tool does not own.
- Three-platform CI and per-target VSIX packaging.

## Phase P0 - repository baseline

The repository had no Git history, and the version string was duplicated across four
files, so a release could ship a companion whose reported version disagreed with the
extension that installed it.

1. Initialize the repository and import the existing sources as a signed commit.
2. Make the version single-sourced. `scripts/sync-version.mjs` propagates the workspace
   version into the extension manifest, the Cargo workspace, and the installer constant;
   a test fails when the four disagree.
3. Complete the extension manifest for a marketplace listing: `repository`, `bugs`,
   `homepage`, and a raster `icon`.
4. Delete the `ownedFiles` installer field. It was declared, never populated, written to
   the manifest as a permanently empty array, and iterated during uninstall.

**Acceptance.** `git log` shows signed history. Editing any single version location makes
`pnpm test` fail. `vsce package` no longer needs `--allow-missing-repository`.

## Phase P1 - test coverage hardening

The reported 93.98% statement coverage came from an explicit four-file allowlist in
`vitest.config.ts`. The 539-line installer that rewrites `~/.claude.json` and
`~/.codex/config.toml`, the 247-line player that drives navigation, the webview, the
session store, and the activation entry point were all excluded from both the test suite
and the measurement.

1. Replace the coverage allowlist with `src/**/*.ts` and raise the thresholds.
2. Add a typed `vscode` test double so the extension-facing modules become unit
   testable, then cover them:
   - **player**: step boundaries, order switching that preserves the current step, stale
     anchors, relocated anchors, ambiguous anchors that must not be highlighted, deleted
     targets, and workspace escape rejection.
   - **installer**: a realistic `~/.claude.json` fixture with comments and trailing
     commas that must survive byte-for-byte outside the managed property, refusal to
     overwrite an unowned skill, per-agent rollback, backup creation, idempotent removal.
   - **storage**: fingerprint mismatch, malformed session files, multi-root workspaces,
     data directory precedence.
   - **webview**: every rejected message shape, and content security policy generation.
3. Measure Rust coverage in CI with `cargo llvm-cov` under a line threshold, and unit
   test the storage and model modules that had none.
4. Turn the protocol schema into an executable contract: a directory of invalid fixtures
   that both the Rust companion and the TypeScript validator must reject for the same
   reason, so a schema edit cannot land in one language only.
5. Add an end-to-end test that runs the real companion binary over stdio against a real
   Git repository, publishes a session, and asserts the extension resolves it.
6. Grow the extension-host suite beyond command registration into real highlighting,
   order switching, and stale reporting.

**Acceptance.** Whole-source coverage thresholds enforced in CI for both languages. A
change to `walkthrough-v1.schema.json` breaks tests in both languages until both are
updated.

## Phase P2 - correctness

1. **Workspace root resolution.** The companion derived the workspace fingerprint from
   its own working directory. An agent started in a subdirectory produced sessions that
   the extension silently ignored. Resolve the Git top level first, accept an explicit
   root, and report a mismatch as a diagnosable error instead of an empty list.
2. Generate the webview nonce from a cryptographic source rather than `Math.random`.
3. Stop skipping hunk-coverage validation entirely for degraded baselines. Validate, then
   downgrade the failure to a warning that names each uncovered hunk in the UI.
4. Round-trip the anchor hash across CRLF, missing trailing newline, and empty files so
   the Rust and TypeScript normalizations cannot drift apart.
5. Replace the fixed-interval session poll with a filesystem watch plus a slow poll as a
   fallback for network filesystems.

## Phase P3 - step navigation

v0.1.1 exposed navigation as two buttons in a sidebar, which is the weakest part of the
experience relative to the goal of walking through changes step by step.

1. Keyboard shortcuts for next, previous, and order switching, scoped by a context key.
2. A CodeLens above each anchor, so the explanation is attached to the code rather than
   living only in the sidebar.
3. A step tree grouped by file, or nested by flow dependency, with direct jumping.
4. Per-step diff. The companion already stores the baseline content but never exposed it;
   a step explanation is incomplete without the previous state.
5. Status bar progress and a secondary decoration marking the other steps in the file.
6. Chinese UI strings, matching the documentation.

## Phase P4 - agent integration surface

1. Verify where each agent actually loads skills and MCP servers from. A wrong path makes
   installation report success while the agent never sees the tool. Freeze the result in
   a verification script.
2. Make `Diagnose` probe whether the agent lists the server, not merely whether a file
   exists.
3. Offer project-scoped installation for users who do not want their home configuration
   modified.
4. Document good and bad `flowAfter` usage in the skill, since execution-flow quality
   depends entirely on it.

## Phase P5 - distribution

1. Publish to the VS Code Marketplace and Open VSX from the release workflow, or correct
   the documentation that already promises both.
2. A manual acceptance checklist covering install from VSIX through a real agent task.
3. A short demonstration recording in the README.

## Ordering

P0 before everything. P1 before P3, so that new navigation code is written against
tested modules rather than on top of untested ones. P2 can proceed in parallel with P1
once the test double exists.

## Status

Everything above is implemented as of 0.2.0 except the items listed as deferred.

| Phase | State |
| --- | --- |
| P0 repository baseline | Done. Signed history, `scripts/sync-version.mjs` with a test, complete manifest, dead installer field removed. |
| P1 test coverage | Done. 212 extension tests at 94.7% statements and 88.5% branches over the whole source tree, 46 companion tests including an end-to-end suite over the real binary, a twenty-case shared negative protocol contract, and coverage gates in CI for both languages. |
| P2 correctness | Done. Repository-root workspace identity, filesystem watching, `uncoveredHunks` on degraded baselines, cryptographic nonce, normalization round-trip tests. |
| P3 navigation and interface | Done, except the step tree. |
| Explanation walkthroughs (0.3.0) | Done. `publish_explanation` publishes a tour of unchanged code for an analysis request, and a change walkthrough may include context steps. |
| P4 agent surface | Done, except project-scoped installation. |
| P5 distribution | Publishing and the manual checklist are in place; the demonstration recording is not. |

### Deferred, with reasons

- **Step tree view.** The redesigned sidebar already lists every step, grouped by file
  and clickable. A second tree would be a second navigation surface to keep in step with
  the first, for the same capability.
- **Project-scoped installation.** Each agent stores project configuration differently,
  and two of the three have no documented per-project MCP path that was verifiable here.
  Shipping a half-verified path would produce exactly the silent failure P4 exists to
  remove. It needs a session with each agent's project configuration to confirm first.
- **Demonstration recording.** Needs a real editor session to capture.

### Before the first public release

- Confirm the repository URL in `extension/package.json`. It currently points at
  `github.com/agent-codewalk/agent-codewalk`, which is a placeholder.
- Set `VSCE_PAT` and `OVSX_PAT`, or remove the `marketplace` job from the release
  workflow and correct the README.
- Raise the companion coverage floor in `.github/workflows/ci.yml` to just under the
  first figure `cargo llvm-cov` reports; it starts at 80 because it was introduced
  without a recorded baseline.
- Work through `docs/release-checklist.md`.

## Verification

Every phase is verified with the commands in `CONTRIBUTING.md`:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```
