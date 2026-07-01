# ScieMD Release Readiness Plan

## Current Target

ScieMD `1.1.0` is the current public preview release target. Generated artifacts should be attached
to GitHub Releases and should not be committed to the source repository. This gives users
clear installer downloads without storing changing binaries in Git history. The intended
Windows installer is:

```text
artifacts/installers/ScieMD_1.1.0_x64-setup.exe
```

The Linux installers are built on GitHub-hosted Ubuntu and attached to the release as
`ScieMD_1.1.0_amd64.AppImage` and `ScieMD_1.1.0_amd64.deb`. Do not attach a
standalone `ScieMD.exe` portable build to public releases; Windows users should get
the NSIS installer or MSI package only. Do not distribute `ScieMD.next.exe` or
`ScieMD.updated.exe`; those are gated local updater smoke-test copies only.

## Required Local Gate

Before opening a merge request or sharing a build, run the full local pre-merge gate:

```bash
npm run validate:merge
```

This runs release validation, the large-document/OOM stress gate, a packaged
desktop build, required packaged desktop smoke testing, desktop artifact staging,
VSIX packaging and package-content checks, required installed-VSIX smoke testing,
VSIX staging, release identity checks, package-size budget checks, generated-output policy checks, and
`git diff --check`.

The packaged desktop smoke now covers Markdown startup/export, structured file
launch, and manual structured file read/save plumbing for JSON, JSONL, YAML, TOML,
XML, CSV, TSV, and plain text. The installed-VSIX smoke installs the package into an
isolated VS Code profile, executes `scieMd.openStructuredPreview` for JSON,
JSONL, YAML, TOML, and XML fixtures, and verifies structured JSON/JSONL edit
commands and preview associations remain default-off.

`npm run validate:release` also runs the release identity guard and
generated-output policy guard, which keeps CI and local release validation aligned
before the heavier build, test, extension, package-budget, Rust, and clippy checks run.

Package-size and performance thresholds are documented in
`docs/refactor/release_package_budgets.md` and enforced by:

```bash
npm run validate:package-budgets
npm run validate:package-budgets -- --vsix --desktop-bundles
```

The first form checks built desktop and VS Code extension output. The second form
also requires local VSIX and desktop installer artifacts and is used by the
pre-merge gate after packaging.

For a release artifact rebuild without the final whitespace check:

```bash
npm run release:local
```

`release:local` still runs the required packaged desktop smoke and required
installed-VSIX smoke before staging artifacts, then re-runs the generated-output
policy guard after staging.

Confirm these files exist:

```text
artifacts/installers/ScieMD_1.1.0_x64-setup.exe
artifacts/installers/ScieMD_1.1.0_x64_en-US.msi
artifacts/installers/sciemd-vscode-1.1.0.vsix
artifacts/SHA256SUMS.txt
```

Linux `.deb` and `.AppImage` assets are generated in GitHub Actions rather than by
the Windows local release command.

## Generated Outputs And Ignored Paths

The following outputs are expected to be regenerated and ignored by Git:

- Frontend and test output: `dist/`, `coverage/`, `.vite/`, `output/`, `tmp/`.
- Tauri output: `src-tauri/target/`, `src-tauri/gen/`, `.runtime-test/`.
- Release staging output: `artifacts/`, including `artifacts/installers/`.
- Local VS Code packages: `scie-md-vscode-extension/*.vsix`.
- Desktop/install packages: `*.exe`, `*.msi`, `*.msix`, `*.app`, `*.dmg`,
  `*.deb`, `*.rpm`.
- Local logs and smoke output: `*.log`, `desktop-build-smoke/`.

Generated installers, VSIX packages, and checksum manifests belong in GitHub
Releases, not source commits.

The generated-output policy can be checked directly with:

```bash
npm run validate:generated-outputs
npm run validate:generated-outputs:self-test
```

The guard allows ordinary source and documentation changes in an in-progress
working tree, but fails if generated directories, packaged artifacts, temporary
outputs, checksum manifests, logs, or Windows reserved names appear in tracked or
untracked Git status.

## GitHub Release Flow

Push a version tag to create a release with installable assets:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The release workflow builds and uploads:

- Windows NSIS installer: `ScieMD_*_x64-setup.exe`
- Windows MSI: `ScieMD_*_x64_en-US.msi`
- VS Code extension: `sciemd-vscode-*.vsix`
- Linux AppImage: `ScieMD_*_amd64.AppImage`
- Linux Debian package: `ScieMD_*_amd64.deb`
- macOS disk image: `*.dmg`
- SHA-256 checksum manifests

The repository root should contain source, tests, docs, and build scripts. Installers
belong under the release's downloadable assets.

## Public Preview Notes

- Builds are unsigned, so Windows SmartScreen may warn. Ask testers to verify the SHA-256 checksum before running the installer.
- The Windows installer registers ScieMD in Open With / Default Apps for `.md`,
  `.markdown`, `.json`, `.jsonl`, `.ndjson`, `.yaml`, `.yml`, `.toml`, `.xml`,
  `.tsv`, `.txt`, and `.text`. CSV remains unclaimed at the OS level so Excel can
  stay the default, while ScieMD keeps in-app CSV open/save support. For interactive
  installs, the NSIS installer offers to open the Windows Default Apps page for
  ScieMD so the user can approve protected default-app changes in Settings.
- In VS Code, ScieMD registers Markdown custom-editor associations only. Structured
  JSON, JSONL, YAML, TOML, and XML support is command-based read-only preview by
  default; JSON/JSONL replacement commands remain opt-in.
- Pandoc-backed export formats require Pandoc to be installed separately.
- ScieMD stores document data locally and does not include built-in LLM calls.

## Before Wider Public Release

- Add Windows code signing.
- Add macOS signing and notarization.
- Set `SCIEMD_REQUIRE_SIGNED_DISTRIBUTION=1` in production release CI.
- Add an updater endpoint and Tauri updater signing keys if automatic updates are enabled.
- Publish a public download page with checksums, install instructions, known limitations, and support contact.
- Regenerate dependency license evidence from `package-lock.json`, `src-tauri/Cargo.lock`,
  and `scie-md-vscode-extension/package-lock.json`.
- Route AGPL-incompatible licensing requests to Scienfy Inc. at `info@scienfy.com` for a
  separate written commercial agreement.
