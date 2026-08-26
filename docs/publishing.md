# Publishing Agent CodeWalk

Agent CodeWalk is distributed through three channels from the same tagged source:

1. Visual Studio Marketplace for VS Code and compatible editors that use Microsoft's
   registry;
2. Open VSX for VSCodium and Code OSS-based editors; and
3. GitHub Releases for direct, offline, pinned, and auditable VSIX downloads.

The release workflow builds platform-specific packages because every VSIX contains a
native Rust companion. Do not publish a universal package without a separately designed
runtime download mechanism; Agent CodeWalk intentionally has no runtime network access.

## Release outputs

| Target | GitHub asset | Typical host |
| --- | --- | --- |
| `linux-x64` | `agent-codewalk-linux-x64.vsix` | Linux desktop, WSL, most Remote SSH hosts |
| `win32-x64` | `agent-codewalk-win32-x64.vsix` | Windows x64 |
| `darwin-x64` | `agent-codewalk-darwin-x64.vsix` | Intel macOS |
| `darwin-arm64` | `agent-codewalk-darwin-arm64.vsix` | Apple silicon macOS |

The GitHub release also contains `SHA256SUMS`. GitHub Actions attaches build provenance to
the VSIX files before the release is published.

## One-time project setup

Complete these steps before creating the first public tag.

### Canonical repository

1. Create or transfer the public repository to
   `https://github.com/andylin-hao/agent-codewalk`.
2. Make `main` the protected default branch and enable GitHub Actions.
3. Enable private vulnerability reporting in the repository Security settings.
4. Confirm the repository, homepage, bugs, badge, and documentation URLs all use the same
   canonical location.

The release workflow publishes registries only when `github.repository_owner` is
`andylin-hao`; forks still build and test but cannot publish official packages.

### Visual Studio Marketplace

1. Create or verify the `agent-codewalk` publisher in the Visual Studio Marketplace.
2. Confirm the account you upload from can manage that publisher.
3. Review publisher display name, icon, support links, and verification options in the
   Marketplace portal.

Uploads are manual. The release workflow holds no marketplace credentials, so a tag
builds and releases the packages but never reaches a registry.

### Open VSX

1. Sign the required Eclipse publisher agreement.
2. Create the `agent-codewalk` namespace if it does not exist:

   ```bash
   corepack pnpm dlx ovsx create-namespace agent-codewalk -p <token>
   ```

3. Claim namespace ownership so the listing can be verified.

Never place an access token in a repository file, shell history shared with others, build
log, issue, or release note.

## Prepare a version

Agent CodeWalk repeats its version where the package managers and installed companion need
it. `package.json` at the repository root is the reference value.

1. Update the root `package.json` version without creating a tag.
2. Synchronize the extension, Cargo workspace, and installer constant:

   ```bash
   node scripts/sync-version.mjs
   ```

3. Let Cargo refresh the workspace package entry in `Cargo.lock`:

   ```bash
   cargo check --workspace
   ```

4. Add a user-focused entry at the top of `extension/CHANGELOG.md`.
5. Update the README, roadmap, compatibility notes, and release checklist when the release
   changes installation, platforms, protocol compatibility, privacy, or limitations.
6. Run the full [release checklist](release-checklist.md).

`node scripts/sync-version.mjs --check` must report one version before the release commit
is created.

## Tag and publish

Create a signed release commit and annotated tag only after the branch is green:

```bash
git commit -s -m "chore(release): prepare 0.8.0"
git tag -s v0.8.0 -m "Agent CodeWalk 0.8.0"
git push origin main
git push origin v0.8.0
```

Pushing `v*` starts `.github/workflows/release.yml`:

1. The `package` matrix checks out the tag on Linux, Windows, Intel macOS, and Apple
   silicon macOS.
2. Each runner installs locked dependencies, verifies version synchronization, builds the
   native companion, bundles the extension, stages the companion, and packages one target
   VSIX.
3. The `publish` job downloads those exact artifacts, generates `SHA256SUMS`, attaches
   provenance, and creates a GitHub release with generated notes and all assets.

The workflow stops there. Upload the released VSIX files to the Visual Studio Marketplace
and Open VSX yourself, taking them from the GitHub release so that all three channels
carry byte-identical packages:

```bash
gh release download v0.8.0 --pattern "*.vsix"
corepack pnpm dlx @vscode/vsce publish --packagePath agent-codewalk-*.vsix
for package in agent-codewalk-*.vsix; do
  corepack pnpm dlx ovsx publish "$package"
done
```

Upload every platform package. A registry that carries only one of them leaves the other
platforms installing an extension whose companion binary cannot run.

## Verify all three channels

Do not announce the release until the workflow is green and each public surface is checked.

### GitHub Releases

- The tag and release version match the extension manifest.
- All four VSIX files and `SHA256SUMS` are attached.
- The provenance attestation is present.
- `sha256sum -c SHA256SUMS` succeeds after downloading the assets on Linux.
- Release notes are readable, user-focused, and do not expose internal paths or secrets.

### Visual Studio Marketplace

- The listing shows the new version, icon, product figure, README, changelog, license,
  repository, issue, and privacy/security links.
- Linux, Windows, macOS Intel, and macOS Apple silicon are available for the same version.
- A clean VS Code profile can find and install `agent-codewalk.agent-codewalk`.
- The bundled companion target matches the extension host.

### Open VSX

- The listing shows the same version and documentation.
- Every supported platform package is present.
- VSCodium can find and install `agent-codewalk.agent-codewalk` in a clean profile.
- The package is attributed to the owned `agent-codewalk` namespace.

### Product smoke test

From a clean profile and clean agent configuration:

1. Install from each registry on at least one representative machine.
2. Run setup and inspect the planned paths.
3. Confirm `node scripts/verify-agent-install.mjs` sees each available agent.
4. Publish and play one change walkthrough with a modified block and one explanation
   walkthrough without file edits.
5. Check keyboard navigation, CodeLens, dependency graph, file view, and before/after diff.
6. Remove integrations and confirm unrelated configuration and sessions remain.

## Fixing a failed release

Do not move or reuse a published tag.

- If packaging fails before publication, fix the cause, bump to a new patch version, and
  create a new tag.
- If GitHub succeeds but a registry fails, keep the release visible, fix the credential or
  registry issue, and rerun only when the upload is idempotent. If the artifact itself is
  wrong, publish a new patch version.
- If a serious defect reaches users, mark the affected GitHub release clearly, publish a
  corrected patch, and use the registry's supported deprecation mechanism where available.
- Never replace a VSIX under an existing version with different bytes. Checksums,
  provenance, and user expectations depend on immutability.

Record the incident and corrective action in the new release notes and changelog when it
affects users.
