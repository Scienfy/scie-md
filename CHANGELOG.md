# Changelog

All notable ScieMD release changes are tracked here.

## 1.0.11 - Startup Launch Hardening

- Fixed cold-start Markdown file association launches so double-clicked `.md` and
  `.markdown` files open directly when ScieMD is closed.
- Hardened Windows launch argument parsing for quoted paths, `file://` URLs,
  command-line blobs, and spaced paths.
- Added startup document diagnostics, bounded recovery-draft checks, and duplicate
  pending-launch suppression.
- Corrected NSIS file-association command quoting for installed Windows builds.

## 1.0.10 - Public Preview Hardening

- Aligned desktop, Tauri, Rust, documentation, and VS Code extension release identity.
- Added release and drift guard coverage for duplicated desktop and VS Code editor code.
- Added stricter visual round-trip validation coverage for scientific Markdown edge cases.
- Hardened local export and file-access release gates.

## 1.0.0 - Public Preview

- Initial public preview of the ScieMD desktop Markdown editor.
- Added Windows installer, Windows MSI, macOS disk images, portable Windows executable,
  VS Code extension package, and SHA-256 checksum manifest as release assets.
- Released source under AGPLv3-or-later with commercial licensing available from
  Scienfy Inc. for AGPL-incompatible use.
- Added contribution, security, contributor agreement, third-party license, and font
  attribution documentation.
