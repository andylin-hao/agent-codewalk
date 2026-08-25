# Contributing

Create a focused branch from `main` and submit changes through a pull request. Preserve existing behavior unless the change is named, documented, and tested.

## Quality requirements

- Keep the JSON Schema, Rust model, TypeScript validator, MCP tool schemas, skill instructions, and documentation consistent.
- Add type hints to every TypeScript and Rust API. Public Rust results require `# Errors` documentation.
- Use clear errors for invalid paths, ranges, dependency graphs, configuration files, and lifecycle states.
- Use the VS Code log output channel or stderr for diagnostics; never mix logs into MCP stdout.
- New UI behavior needs protocol/core tests and, where appropriate, extension-host coverage.
- Never weaken workspace path validation, ownership checks, atomic writes, or stale-anchor handling for convenience.

Run before opening a PR:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Commits and PR titles use `<type>(<scope>): <imperative description>`. Keep the PR description concrete, include verification results, and sign every commit with `git commit -s`.

