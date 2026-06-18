# ScieMD Markdown Editor for VS Code

ScieMD is a WYSIWYG Markdown editor for scientific writing: research papers,
theses, lab notes, technical reports, LaTeX math, citations, Mermaid diagrams,
visual reading styles, and LLM-assisted revision.

This VS Code extension brings the ScieMD visual editor into VS Code. The full
ScieMD product is primarily a Rust/Tauri desktop application from Scienfy Inc.,
with installable Windows and macOS builds published on GitHub:

- Desktop app downloads: https://github.com/Scienfy/scie-md/releases/latest
- Source code: https://github.com/Scienfy/scie-md
- Scienfy: https://scienfy.com

Use the desktop app when you want the complete local-first ScieMD experience,
including desktop packaging and export workflows. Use this VS Code extension when
your writing project already lives in VS Code and you want to open `.md` files in a
scientific visual editor without leaving your workspace.

## Scientific Markdown

ScieMD keeps Markdown as the source of truth. Your file remains readable plain text,
but the editor gives you a document-like writing surface for scientific work.

It supports:

- `.md`, `.scie.md`, and `.sciemd.md` documents.
- Visual editing and source editing in the same custom editor.
- LaTeX-style math rendering through KaTeX.
- Mermaid diagrams.
- Tables, task lists, code blocks, links, images, blockquotes, and common Markdown
  structures.
- Scientific ScieMD blocks such as notes, results, figures, callouts, tips,
  important notes, and warnings when used in ScieMD Markdown.
- Variable insertion and variable expansion for reusable manuscript values.

Markdown is a strong format for hybrid human and LLM writing because it is portable,
transparent, easy to diff, and easy for external LLMs to read without a proprietary
document parser.

## Hybrid Writing With LLMs

ScieMD does not send your writing to an LLM by itself. Instead, it helps you prepare
clean, explicit instructions for an external LLM while keeping control in your hands.

Useful commands:

- **Insert Note to LLM** inside the editor to leave a direct instruction beside the
  paragraph, section, or selected sentence that needs revision.
- **Copy ScieMD LLM Skill** to copy guidance that teaches an LLM how to preserve
  ScieMD Markdown markers.
- **Generate ScieMD_LLM_skill.md Beside Document** to create a reusable instruction
  file next to your manuscript.

A practical workflow:

1. Write normally in Markdown or visual mode.
2. Add **Note to LLM** comments where you want help, for example "tighten this
   abstract", "keep the claim cautious", or "suggest two shorter title versions".
3. Copy the relevant Markdown and the ScieMD LLM skill into your preferred LLM.
4. Paste the revised Markdown back into VS Code.
5. Review the change before saving.

This keeps the LLM workflow visible in the document instead of hidden in a chat log.

## Visual Reading And Writing Styles

ScieMD can show the same Markdown document in different visual styles so you can
quickly evaluate how the writing feels in different contexts.

Included style modes:

- Scientific Draft
- Journal Manuscript
- Lab Notebook
- Technical Code
- Codex
- Scienfy
- Science-inspired
- Nature-inspired
- Claude-inspired

This is useful when a manuscript needs to move between rough notes, lab records,
preprint drafts, review-style reading, and journal-like presentation.

## Text Versions

Scientific writing often needs several candidate phrasings before one is selected.
ScieMD supports text versions stored in Markdown comments, so you can keep alternate
abstracts, titles, claims, or paragraph revisions in the same file and switch the
active version visually.

Use text versions for:

- Abstract variants.
- Short and long titles.
- Alternative interpretations of a result.
- Reviewer-response wording.
- Human draft versus LLM-assisted revision.

## Citations, Cross-References, And Pandoc Export

The VS Code extension focuses on visual Markdown editing inside VS Code. The full
ScieMD desktop app is the recommended route for broader release workflows and
desktop export use.

In the ScieMD project, Pandoc-backed workflows can produce formats such as DOCX,
EPUB, LaTeX, PDF, ODT, JATS, and other scholarly formats when Pandoc is installed.
The desktop app also supports citation style files such as `.csl` files for
Pandoc-based export.

Download the desktop app here:

https://github.com/Scienfy/scie-md/releases/latest

## How To Use The Extension

After installing:

1. Open a Markdown file in VS Code.
2. Run **Open With ScieMD Markdown Editor** from the Command Palette.
3. Use visual mode when you want to write and read like a document.
4. Switch to source mode when you want direct Markdown control.
5. Use the style selector to move between scientific, journal, lab notebook, and
   other visual modes.
6. Add Note to LLM comments when a specific passage needs external LLM help.
7. Save normally with VS Code.

The Markdown file remains the source of truth. Edits made in the ScieMD webview are
written back to the VS Code text document, so normal save, dirty state, undo/redo,
and external document change behavior still follow VS Code's editor model.

## Install The Desktop App

Many users should start with the desktop app rather than the extension.

1. Open https://github.com/Scienfy/scie-md/releases/latest
2. Expand **Assets**.
3. Download the installer for your operating system:
   - Windows: `ScieMD_*_x64-setup.exe`
   - macOS Apple Silicon: `ScieMD_*_aarch64.dmg`
   - macOS Intel or mixed environments: `ScieMD_*_universal.dmg`
4. Install and open ScieMD.

The GitHub **Code** button is for source code. Regular users should use release
assets.

## Install This VS Code Extension

From the Marketplace, choose **Install**.

If you downloaded a `.vsix` file manually:

1. Open VS Code.
2. Go to **Extensions**.
3. Choose **Install from VSIX...** from the Extensions menu.
4. Select `sciemd-vscode-*.vsix`.
5. Open a Markdown file and run **Open With ScieMD Markdown Editor**.

Command-line installation:

```powershell
code --install-extension .\sciemd-vscode-1.0.1.vsix --force
```

## Who This Is For

ScieMD is designed for:

- Researchers writing papers, preprints, reports, and review notes.
- Graduate students writing theses and dissertation chapters.
- Labs keeping Markdown-based notebooks and reproducibility records.
- Technical writers who need math, diagrams, citations, and structured notes.
- Writers who use external LLMs but want the document file to remain transparent.

It is not meant to replace every Markdown extension. It is focused on scientific and
academic writing where visual structure, Markdown portability, and LLM-readable
source files matter.

## Current Extension Scope

Implemented in this VS Code extension:

- Custom editor for `.md`, `.scie.md`, and `.sciemd.md`.
- Real ScieMD visual editor using Milkdown/ProseMirror.
- Source mode using CodeMirror.
- Visual style selector.
- VS Code-aware light and dark theme handling, with manual theme overrides.
- Variable expansion and variable insertion.
- Note to LLM and Note to Human insertion.
- Text Version insertion.
- Save and writeback through VS Code documents.
- External document change detection with a review path.

Desktop-only features, including Tauri-native dialogs and some export flows, belong
to the ScieMD desktop app.

## Open Source And License

ScieMD is open source software with dual licensing:

- Open-source license: GNU Affero General Public License v3.0 or later
  (`AGPL-3.0-or-later`).
- Commercial license: available from Scienfy Inc. for proprietary, closed-source,
  embedded, hosted, white-label, enterprise, or other AGPL-incompatible use.

Commercial licensing inquiries: info@scienfy.com

## Contributing

The extension source is part of the ScieMD repository:

https://github.com/Scienfy/scie-md

Bug reports and feature requests are welcome through GitHub Issues.

## Developer Notes

This section is for contributors working on the extension internals.

- `src/extension` is the VS Code adapter. It registers the custom editor, applies
  edits through `WorkspaceEdit`, handles save/dirty state, watches document changes,
  and owns clipboard/file-system commands.
- `src/webview` is the VS Code webview host for the ScieMD editor.
- `src/scie-md` is the copied ScieMD app/editor core used by the webview.
- `src/shared` keeps shared Markdown and LLM utilities used by the extension host
  and tests.

Build and test:

```powershell
npm install
npm run test
npm run build
npm run package
```

The package command creates `sciemd-vscode-1.0.1.vsix` in this folder.
