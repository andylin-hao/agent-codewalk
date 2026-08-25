# Release checklist

Automated checks cover the protocol, the companion, and the extension modules. They
cannot cover installing a real VSIX and running a real agent, which is what this list is
for. Work through it on at least one platform before tagging.

## Before tagging

1. `node scripts/sync-version.mjs --check` reports one version.
2. `corepack pnpm check && corepack pnpm test` pass.
3. `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
   and `cargo test --workspace` pass.
4. `corepack pnpm --filter agent-codewalk test:extension` passes (needs a display; CI
   uses `xvfb-run`).
5. `extension/CHANGELOG.md` has an entry for this version.

## Install from the artifact

6. Build the VSIX: `corepack pnpm --filter agent-codewalk package`.
7. Install it into a clean profile: `code --profile codewalk-test --install-extension extension/agent-codewalk-*.vsix`.
8. The extension appears with its icon and description, in the editor's language.

## First run

9. Run **Agent CodeWalk: Setup Agent Integrations**. The confirmation lists every file
   it will touch, and no file outside that list changes.
10. `node scripts/verify-agent-install.mjs` reports every installed agent as PASS.
11. **Agent CodeWalk: Diagnose Installation** reports the companion as OK and each agent
    as listing the server.

## A real task

12. In a Git repository, ask an agent to make a change spanning at least two files, one
    of which modifies existing code.
13. The agent calls `begin_task` before its first edit and `publish_walkthrough` after
    verifying. A notification offers to open the result.
14. Stepping opens each file and highlights the described block. `Alt+]` and `Alt+[`
    move; `Alt+\` switches order; `Ctrl+Alt+W` jumps.
15. A code lens appears above each explained block.
16. **Compare Current Step With Before** opens a diff for a modified step, and reports
    that there is nothing to compare for a purely added one.
17. Edit one of the explained blocks, then revisit its step: it reports stale rather
    than highlighting the wrong range.

## An explanation

18. Ask the agent to explain how something in the repository works, without changing
    anything. It publishes an explanation without calling `begin_task`.
19. The sidebar marks it as an explanation, the highlights are neutral rather than
    diff-coloured, and no diff is offered.
20. Ask a question that points at no code ("how should I configure this?"). Nothing is
    published.

## Degraded and edge paths

21. Ask an agent to change code without calling `begin_task`. The session publishes,
    is marked as degraded, and lists any unexplained hunks.
22. Start an agent in a subdirectory of the repository. Its walkthrough is still found.

## Removal

23. **Agent CodeWalk: Remove Agent Integrations** removes only the entries this tool
    owns. Unrelated MCP servers and hooks in the same files survive.
24. Uninstall the extension; the data directory keeps published sessions.
