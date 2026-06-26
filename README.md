# ScieMD

ScieMD is a scientific Markdown desktop editor from Scienfy Inc. for researchers,
clinicians, students, and technical writers who want a readable writing file and a
visual writing surface at the same time.

Modern scientific writing is increasingly hybrid: people draft, revise, summarize,
and reorganize text with help from LLMs, but the manuscript still needs figures,
tables, equations, citations, versioned wording, journal-like formatting, and a file
format that remains understandable outside any one app. Plain `.md` Markdown is a
strong fit for this workflow because it is transparent, portable, easy for LLMs to
read, and safe to inspect in any text editor. ScieMD builds on that idea by keeping
your document as Markdown while adding scientific writing tools around it.

## Download

Most users should download ScieMD from the GitHub Releases page, not from the source
code file list:

- [Download the latest ScieMD release](https://github.com/scienfy/scie-md/releases/latest)
- [See all releases](https://github.com/scienfy/scie-md/releases)

Open the release page, expand **Assets**, and choose the file for your system:

- Windows: download `ScieMD_*_x64-setup.exe` for normal installation.
- Windows MSI: download `ScieMD_*_x64_en-US.msi` only if your institution requires MSI installers.
- macOS Apple Silicon: download `ScieMD_*_aarch64.dmg`.
- macOS Intel: download `ScieMD_*_x64.dmg` if available, or `ScieMD_*_universal.dmg`.
- VS Code extension: download `sciemd-vscode-*.vsix`.
- Checksums: use the `SHA256SUMS*.txt` files if you want to verify a download.

The green **Code** button is for people who want to inspect or build the source code.
Regular users should use the release assets above.

## Why ScieMD

ScieMD is designed for scientific writing that needs more structure than a normal
note app, but less friction than a full typesetting system.

- Write readable Markdown while seeing equations, citations, figures, tables, SVG
  figures, callouts, results, notes, and Mermaid diagrams rendered visually.
- Add **Note to LLM** markers directly beside the paragraph, section, or selected
  sentence that needs revision.
- Generate a `ScieMD_LLM_skill.md` file so an external LLM can understand how to edit
  ScieMD Markdown without damaging figures, variables, comments, or text versions.
- Keep multiple text versions for a sentence, abstract, title, or paragraph, then
  switch the active version with one click.
- View the same document in familiar writing styles such as Scientific Draft,
  Journal Manuscript, Lab Notebook, Science-inspired, Nature-inspired, and Scienfy.
- Insert manuscript variables from front matter or local JSON/CSV analysis outputs
  so values can be reused consistently during writing and export.
- Export styled HTML directly, or use Pandoc for DOCX, EPUB, LaTeX, PDF, ODT, JATS,
  and other scholarly formats.
- Choose citation style files such as `.csl` files when exporting through Pandoc.
- Work local-first: your documents are ordinary files on your machine, and the app
  only reads or writes files and folders you select through the native file pickers.

ScieMD does not send your document to an LLM by itself. The intended workflow is that
you decide when to copy or share Markdown with an external LLM, keep instructions in
the document as Note to LLM markers, and review the returned Markdown before saving.

## VS Code Extension

ScieMD also ships as a VS Code custom editor for people who already organize writing
projects in VS Code.

To install it:

1. Download `sciemd-vscode-*.vsix` from the latest release assets.
2. Open VS Code.
3. Go to **Extensions**.
4. Choose **Install from VSIX...** from the Extensions menu.
5. Select the downloaded `.vsix` file.

Command-line installation also works:

```bash
code --install-extension sciemd-vscode-1.0.10.vsix
```

## Public Preview Status

The current release is a public preview. The installers are built by GitHub Actions
from the tagged source release and attached to the GitHub Release page.

Expected first-run warnings:

- Windows may show Microsoft SmartScreen because the app is not code-signed yet. If
  you trust the download source, choose **More info** and then **Run anyway**.
- macOS may warn because the app is not notarized yet. You may need to right-click
  the app and choose **Open** the first time.
- Pandoc-based exports require Pandoc to be installed separately on your machine.

Release signing, macOS notarization, updater configuration, and the public download
page are tracked in [RELEASE_READINESS_PLAN.md](RELEASE_READINESS_PLAN.md).

## License

ScieMD is open source software with dual licensing:

- Open-source license: GNU Affero General Public License v3.0 or later
  (`AGPL-3.0-or-later`).
- Commercial license: available from Scienfy Inc. for proprietary, closed-source,
  embedded, hosted, white-label, enterprise, or other AGPL-incompatible use.

Individuals, scientists, students, research groups, and organizations may use,
study, modify, and share ScieMD under the AGPL, as long as they follow the AGPL
terms. If your organization needs terms that do not fit the AGPL, contact Scienfy
Inc. at <info@scienfy.com> or visit <https://scienfy.com>.

See [LICENSE](LICENSE), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), and
[FONT_LICENSES.md](FONT_LICENSES.md).

## Source Code

The source code is available in this repository for review, reproducibility, and
community contribution. GitHub also attaches source archives to every release.

Generated installers, VSIX packages, checksums, autosave backups, and local build
outputs are intentionally not stored in the Git source history. They belong on the
GitHub Releases page so researchers can download the app easily while developers can
clone a small source repository.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) before opening issues or pull requests. Bug
reports and feature requests can be opened from the repository's **Issues** tab.

For security reports, use the private contact path in [SECURITY.md](SECURITY.md)
instead of opening a public issue.

## Development

Developer setup requires Node.js, Rust, and the Tauri prerequisites for your
operating system.

```bash
npm ci
npm run dev
```

Run the desktop app through Tauri during local testing:

```bash
npm run tauri -- dev
```

Validate a release build before sharing it:

```bash
npm run validate:release
```

Build local desktop and VS Code release artifacts:

```bash
npm run release:local
```

The VS Code extension source is in `scie-md-vscode-extension/`:

```bash
cd scie-md-vscode-extension
npm ci
npm run build
npm run test
```
