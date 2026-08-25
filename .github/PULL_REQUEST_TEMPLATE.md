## Problem

<!-- What user or maintainer problem does this solve? Link the issue when one exists. -->

## Change

<!-- Describe the resulting behavior and the important design decisions. -->

## Risk and compatibility

<!-- Cover protocol, stored sessions, user configuration, privacy, security, and rollback. -->

## Verification

<!-- List the exact commands and manual checks you ran, with results. -->

- [ ] TypeScript type checking and ESLint
- [ ] Vitest with coverage and production bundle smoke test
- [ ] rustfmt and Clippy with warnings denied
- [ ] Rust unit and integration tests
- [ ] Production extension build/package
- [ ] Extension-host or real-agent checks when relevant

## Documentation

- [ ] User-facing behavior is tested and documented.
- [ ] English and Simplified Chinese content stay equivalent where affected.
- [ ] `extension/CHANGELOG.md` is updated for user-visible changes.
- [ ] Screenshots or a short recording are attached for visible UI changes.

## Contributor statement

- [ ] The PR title follows Conventional Commits with a scope and lowercase imperative
  description.
- [ ] Every commit includes a `Signed-off-by:` line.
- [ ] The change contains no secrets, private source, or unrelated generated files.
