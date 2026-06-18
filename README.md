# ScieMD

ScieMD is a desktop Markdown editor for scientific writing, developed by Scienfy Inc. It keeps the saved file as readable Markdown while adding visual editing for papers, lab notes, local data-backed writing, and optional LLM-assisted revision.

## Download

Installable public preview builds are published on the GitHub Releases page:

- Latest release: `https://github.com/scienfy/scie-md/releases/latest`
- All releases: `https://github.com/scienfy/scie-md/releases`

For Windows, download `ScieMD_*_x64-setup.exe`. For macOS, download the `.dmg`.
For VS Code, download `sciemd-vscode-*.vsix` and install it from the Extensions view or
with `code --install-extension`.
Source code is available in the repository and is also attached automatically by GitHub
to every release as source archives.

## License

ScieMD is dual licensed:

- Open-source license: GNU Affero General Public License v3.0 or later
  (`AGPL-3.0-or-later`).
- Commercial license: available for proprietary, closed-source, embedded, white-label,
  hosted, enterprise, or other AGPL-incompatible use.

Under the AGPL, users can use, study, modify, and share ScieMD, but distributed or
network-hosted modified versions must provide corresponding source under AGPL terms.
Organizations that need different terms should contact Scienfy Inc. for a commercial license.
See `LICENSE` and `COMMERCIAL-LICENSE.md`.

## Scope

- Standard Markdown and GFM tables, task lists, code blocks, images, links, and blockquotes.
- Scientific Layer 2 blocks using readable `:::` directives: `:::figure`, `:::result`, `:::note`, `:::callout`, `:::tip`, `:::important`, and `:::warning`.
- Visual rendering for math, Mermaid diagrams, directive cards, citations, cross-references, images, and SVG figures.
- Dynamic manuscript variables from front matter or local JSON/CSV analysis outputs, substituted during export and preserved for external LLM review.
- Active text variants and targeted block-level LLM instruction comments stored as transparent Markdown comments.
- Source mode with CodeMirror, find/replace, citation autocomplete, cross-reference autocomplete, and keyboard shortcuts.
- Local-first file workflow with atomic writes, autosave, backups, recent files, file explorer, and external-change detection.
- Session-scoped file access: the desktop backend only reads or writes files/folders that were selected through ScieMD's native open/save/folder/image pickers.
- Export to self-contained HTML and Pandoc-backed DOCX, EPUB, LaTeX, and PDF when Pandoc is installed.

ScieMD does not include built-in LLM calls. When you choose to work with an external LLM, leave Note to LLM markers in the document, give the LLM the ScieMD skill instructions, and review pasted changes when the edited Markdown returns.

## Development

```bash
npm ci
npm run dev
```

Run the app through Tauri during desktop testing:

```bash
npm run tauri -- dev
```

Desktop development also requires the Tauri prerequisites for your operating system.
Scie Sans font rebuilds require Python 3 and `fonttools`:

```bash
python -m pip install fonttools
```

## VS Code Extension

The `scie-md-vscode-extension/` folder contains a separate VS Code custom editor package
that reuses the ScieMD editor core in a VS Code webview.

```bash
cd scie-md-vscode-extension
npm ci
npm run build
npm run test
```

## Validation

Use the release validation script before handing a build to anyone:

```bash
npm run validate:release
```

That runs:

- TypeScript and Vite build
- Vitest unit tests
- Milkdown round-trip review corpus
- Rust unit tests
- Rust clippy with warnings denied

## Local Preview Build

```bash
npm run release:local
```

This builds the Tauri desktop app, runs the release validation gate, and refreshes the local release artifacts:

- `artifacts/ScieMD.exe`
- `artifacts/installers/*` when Tauri emits Windows installer bundles
- `artifacts/installers/sciemd-vscode-*.vsix`
- `artifacts/SHA256SUMS.txt` with checksums for the copied release files

For local updater smoke tests only, set `SCIEMD_COPY_SMOKE_EXES=1` before `npm run copy:exe` to create `ScieMD.next.exe` and `ScieMD.updated.exe`. Do not share those smoke-test copies.

Generated installers, VSIX packages, checksums, autosave backups, and local test builds
belong on the GitHub Releases page, not in the Git source history. This keeps source
checkout small for developers while still giving regular users clear installer downloads.

## Public Preview Distribution

Preview artifacts are currently unsigned builds. Tagged releases such as `v1.0.0` build
Windows and macOS assets with GitHub Actions and attach them to the GitHub Release.

For Windows users, download the NSIS installer:

- `ScieMD_1.0.0_x64-setup.exe`

Use the MSI only if the tester specifically needs MSI-style installation. The portable
`ScieMD.exe` is useful for quick smoke tests, but the installer is the intended preview
artifact.

For VS Code users, share `sciemd-vscode-1.0.0.vsix`.

Expected friction:

- Windows may show Microsoft SmartScreen because the app is not code-signed yet. Users can choose **More info** and then **Run anyway** after verifying the checksum.
- macOS may require right-clicking the app and choosing **Open** because the app is not notarized yet.
- Pandoc exports require Pandoc to be installed separately on the user's machine.
- Release artifacts include SHA-256 checksums in `artifacts/SHA256SUMS.txt` after local builds.

## Open Source Release

ScieMD is released under AGPLv3-or-later, with commercial licensing available for
AGPL-incompatible use. License, contribution, security, and third-party notices are in
`LICENSE`, `COMMERCIAL-LICENSE.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`THIRD_PARTY_LICENSES.md`, and `FONT_LICENSES.md`.

Release signing, macOS notarization, updater configuration, and public download page work
are tracked in `RELEASE_READINESS_PLAN.md`.
