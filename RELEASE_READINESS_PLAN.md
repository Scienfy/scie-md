# ScieMD Release Readiness Plan

## Current Target

ScieMD `1.0.10` is the current public preview release target. Generated artifacts should be attached
to GitHub Releases and should not be committed to the source repository. This gives users
clear installer downloads without storing changing binaries in Git history. The intended
Windows installer is:

```text
artifacts/installers/ScieMD_1.0.10_x64-setup.exe
```

The standalone `artifacts/ScieMD.exe` is a smoke-test/portable fallback. Do not distribute `ScieMD.next.exe` or `ScieMD.updated.exe`; those are gated local updater smoke-test copies only.

## Required Local Gate

Before sharing a build:

```bash
npm run validate:release
npm run build:desktop
npm run copy:exe
```

Confirm these files exist:

```text
artifacts/ScieMD.exe
artifacts/installers/ScieMD_1.0.10_x64-setup.exe
artifacts/installers/ScieMD_1.0.10_x64_en-US.msi
artifacts/installers/sciemd-vscode-1.0.10.vsix
artifacts/SHA256SUMS.txt
```

## GitHub Release Flow

Push a version tag to create a release with installable assets:

```bash
git tag v1.0.10
git push origin v1.0.10
```

The release workflow builds and uploads:

- Windows NSIS installer: `ScieMD_*_x64-setup.exe`
- Windows MSI: `ScieMD_*_x64_en-US.msi`
- Windows portable executable: `ScieMD.exe`
- VS Code extension: `sciemd-vscode-*.vsix`
- macOS disk image: `*.dmg`
- SHA-256 checksum manifests

The repository root should contain source, tests, docs, and build scripts. Installers
belong under the release's downloadable assets.

## Public Preview Notes

- Builds are unsigned, so Windows SmartScreen may warn. Ask testers to verify the SHA-256 checksum before running the installer.
- The installer registers ScieMD for Markdown files only: `.md` and `.markdown`.
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
