# AGENTS.md

Agent CodeWalk is a local-first VS Code/Cursor extension plus a Rust MCP companion. The walkthrough JSON Schema is the shared contract; changes to it must update Rust serialization, TypeScript validation, fixtures, tests, and user documentation together.

Use strict TypeScript and safe Rust. Public APIs need explicit types and concise contract documentation. Reject invalid input at boundaries with actionable messages. Keep resource ownership and cleanup explicit and idempotent. Do not add network access, telemetry, or model API calls without a separate user-approved design and privacy update.

All user-facing changes require tests and documentation. Run TypeScript type checking, ESLint, Vitest coverage, rustfmt, Clippy with warnings denied, Rust unit/integration tests, and a production extension build. Use Conventional Commits with an imperative, lowercase description and include `Signed-off-by:` in every commit.

