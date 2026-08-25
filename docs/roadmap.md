# Roadmap to Agent CodeWalk 1.0

Agent CodeWalk already supports the complete local workflow: Codex, Claude Code, and
OpenCode can publish validated change walkthroughs or tours of existing code, and readers
can follow them in a VS Code-compatible editor through anchored highlights, nested steps,
dependency flow, file order, CodeLens, keyboard navigation, and focused diffs.

The road to 1.0 is therefore about making that workflow dependable for someone who has
never seen the repository—not about adding a second agent, model, or hosted service.

This roadmap describes priorities, not guaranteed dates. Release notes and the issue
tracker are the source of truth for shipped behavior.

## Product principles

1. **Understanding over activity.** The product should help a person form a correct mental
   model of a change, not merely visualize that an agent touched files.
2. **Evidence over self-report.** Change coverage comes from a recorded baseline and the
   real diff, not only from what an agent says it changed.
3. **Safe failure over plausible guessing.** Ambiguous anchors, paths, and configuration
   ownership stop with an actionable message.
4. **Local by default and by architecture.** No telemetry, runtime downloads, hosted
   walkthroughs, or model calls are needed for the core workflow.
5. **One contract across languages.** Schema, Rust, TypeScript, fixtures, skill, tests, and
   documentation move together.
6. **Low-friction reading.** The editor should make the next meaningful block obvious with
   a keyboard, mouse, or screen reader.

## Current foundation

The following capabilities are in place in the current 0.7 series:

- Local stdio MCP tools for task baseline capture, publication, explanation, status, and
  abort
- Complete text-hunk coverage enforcement for normal change walkthroughs
- Explicit degraded sessions with uncovered-hunk reporting when a baseline was missed
- Walkthroughs of unchanged code for analysis, explanation, review, and tracing requests
- Context steps that connect an edit to unchanged callers or contracts
- Nested steps with sibling-level execution dependencies and validated acyclic flow
- File and dependency-graph reading modes with direct, keyboard, CodeLens, and status-bar
  navigation
- Stable hash anchors, unique relocation, stale detection, and per-step before/after diff
- English and Simplified Chinese editor UI
- Transactional, owned-only integration setup and removal for Codex, Claude Code, and
  OpenCode
- Strict cross-language protocol fixtures, extension unit/host tests, Rust unit/integration
  tests, coverage gates, dependency audits, and multi-platform native builds
- Platform-specific VSIX release automation for Linux x64, Windows x64, macOS Intel, and
  macOS Apple silicon

## Milestone 1 — public distribution

Goal: a new user can discover, install, verify, and update Agent CodeWalk without cloning
the repository.

- Publish and verify the `agent-codewalk` identity on the Visual Studio Marketplace and
  Open VSX.
- Publish every tagged VSIX and checksum file on GitHub Releases from the same build
  artifacts used by the registries.
- Keep official releases fail-fast when either registry credential is missing.
- Verify icon, screenshots, README, changelog, license, repository, issue, support, and
  security links on both listings.
- Complete the clean-profile acceptance path on every supported target before calling the
  release stable.
- Establish a predictable patch-release and registry incident process.

**Exit criterion:** a first-time user on each supported platform can install from their
normal registry, complete agent setup, publish both walkthrough kinds, receive updates,
and verify a GitHub VSIX independently.

## Milestone 2 — first-run confidence

Goal: setup should explain itself and diagnose the next action without requiring knowledge
of MCP or agent configuration formats.

- Make agent detection results visible before setup, including agents that are not found.
- Turn the current confirmation into a clearer per-agent plan with backup and ownership
  details.
- Surface real MCP visibility checks immediately after installation.
- Improve empty-state guidance for change and explanation walkthroughs.
- Give stale-companion, degraded-baseline, excluded-change, and unowned-entry notices a
  direct recovery action where the editor API permits.
- Expand manual coverage for Remote SSH, WSL, clean Windows homes, and editors backed by
  Open VSX.

**Exit criterion:** the common “nothing appeared” cases can be resolved from the extension
and output channel without hand-editing JSON or TOML.

## Milestone 3 — reading quality at scale

Goal: walkthroughs should remain clear for changes that span dozens of files and several
levels of abstraction.

- Evaluate the installed skill against representative small, medium, and large changes.
- Add deterministic quality fixtures for hierarchy, range focus, reason statements, and
  useful `flowAfter` edges.
- Improve graph orientation and branch emphasis without introducing a second competing
  navigation model.
- Preserve the reader's expansion, mode, and current-step state when sessions refresh.
- Make large excluded/uncovered lists searchable and collapsible.
- Explore optional session export only if it can preserve local-first privacy and path
  safety; do not introduce sharing by default.

**Exit criterion:** a 50-step walkthrough opens with a useful overview, exposes detail on
demand, and remains fully navigable with keyboard and assistive technology.

## Milestone 4 — reliability and compatibility

Goal: the extension and companion should upgrade safely across the full supported editor
and platform matrix.

- Define and document the schema-version evolution policy before the first incompatible
  change.
- Add compatibility tests that load sessions produced by every supported older minor
  release.
- Exercise interruption and recovery around baseline capture, atomic publication,
  extension shutdown, and installer rollback.
- Add release smoke tests that inspect the companion architecture and protocol version
  inside every produced VSIX.
- Keep dependency audits actionable and raise coverage floors from measured baselines
  without rewarding trivial tests.
- Validate filesystem watching and fallback polling on network and remote filesystems.

**Exit criterion:** upgrades never silently lose sessions, attach them to the wrong
workspace, or leave agent configuration partly owned.

## Milestone 5 — accessibility and localization

Goal: the complete workflow is usable without relying on pointer precision, color alone,
or English-only terminology.

- Audit the webview with keyboard-only navigation and a desktop screen reader.
- Test high-contrast themes, zoom, narrow sidebars, reduced motion, and long translated
  content.
- Keep semantic state and visible state driven by the same attributes.
- Review Simplified Chinese copy with native technical readers and maintain parity with the
  English README, manifest, and webview.
- Document the process for adding a language without duplicating product logic.

**Exit criterion:** all core setup and playback actions are discoverable, named, and
operable through keyboard and assistive technology in both supported languages.

## 1.0 release criteria

Agent CodeWalk 1.0 is ready when:

- all three distribution channels are public, reproducible, and tested;
- the latest release passes the complete automated and manual checklist on all supported
  targets;
- installation and removal preserve unrelated user configuration in real-agent tests;
- protocol compatibility and deprecation rules are documented;
- the common failure modes have actionable, localized diagnosis;
- security reporting, support, contribution, and release ownership are operational; and
- there are no known high-severity correctness, privacy, configuration-ownership, or path
  confinement issues.

## Explicit non-goals before 1.0

- A hosted walkthrough service, account system, or telemetry pipeline
- Runtime model selection or direct model API integration
- Browser-editor support that would require uploading source or running a remote companion
- Automatic publication of walkthroughs to GitHub, pull requests, or team chat
- Project-scoped agent setup without verified, stable configuration contracts for every
  supported agent
- Silent takeover of an existing same-name MCP server or skill

These may be reconsidered only through a separate design that covers user value, failure
modes, privacy, security, ownership, and migration.

## How to contribute to the roadmap

Open an issue describing the user problem, current workaround, desired outcome, and the
milestone it supports. A strong proposal explains how it preserves local-first operation,
protocol consistency, and safe configuration ownership. See
[CONTRIBUTING.md](../CONTRIBUTING.md) before implementing a cross-component feature.
