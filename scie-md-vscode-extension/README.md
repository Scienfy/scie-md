# ScieMD Markdown Editor for VS Code

ScieMD is a WYSIWYG Markdown editor and reader for scientific writing, hybrid LLM
drafting, direct document comments, Markdown commenting, visual writing styles,
LaTeX math, and Mermaid diagrams.

Markdown is the source of truth. Humans can write and read in visual mode, while
external LLMs can work with the same plain `.md` file in source mode, including
document notes, variables, and text-version markers.

## Screenshots

Human visual editing in a light manuscript-style view:

![ScieMD human visual editing in light mode](https://raw.githubusercontent.com/scienfy/scie-md/main/scie-md-vscode-extension/assets/screenshots/human-visual-light.png)

Human visual editing in a dark writing style:

![ScieMD human visual editing in dark mode](https://raw.githubusercontent.com/scienfy/scie-md/main/scie-md-vscode-extension/assets/screenshots/human-visual-dark.png)

Source mode shows the same document as plain Markdown, including the comments,
variables, and text-version markers an external LLM can read and edit:

![ScieMD source mode for LLM-readable Markdown](https://raw.githubusercontent.com/scienfy/scie-md/main/scie-md-vscode-extension/assets/screenshots/llm-source-mode.png)

This VS Code extension brings the ScieMD visual editor into VS Code. The full
ScieMD product is primarily a Rust/Tauri desktop application from Scienfy Inc.,
with installable Windows and macOS builds published on GitHub:

- Desktop app downloads: https://github.com/scienfy/scie-md/releases/latest
- Source code: https://github.com/scienfy/scie-md
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

## How ScieMD Compares

| Feature | ScieMD | Markdown All in One | Markdown Preview Enhanced |
| --- | --- | --- | --- |
| WYSIWYG visual editing | Yes | No | No |
| Plain Markdown source of truth | Yes | Yes | Yes |
| Scientific blocks for figures, results, and notes | Yes | No | Partial |
| Multiple manuscript visual styles | Yes | No | No |
| Text versions inside the document | Yes | No | No |
| LLM-aware notes stored in Markdown | Yes | No | No |
| LaTeX-style math preview | Yes | No | Yes |
| Mermaid diagrams | Yes | No | Yes |

## Hybrid Writing With LLMs

ScieMD does not send your writing to an LLM by itself. Instead, it helps you prepare
clean, explicit instructions for an external LLM while keeping control in your hands.

Useful commands:

- **Insert note** inside the editor to leave a direct instruction beside the
  paragraph, section, or selected sentence that needs revision.
- **Copy ScieMD LLM Skill** to copy guidance that teaches an LLM how to preserve
  ScieMD Markdown markers.
- **Generate ScieMD_LLM_skill.md Beside Document** to create a reusable instruction
  file next to your manuscript.

A practical workflow:

1. Write normally in Markdown or visual mode.
2. Add notes where you want help, for example "tighten this
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

## How To Use The Extension

After installing the extension, opening a `.md`, `.markdown`, `.scie.md`, or
`.sciemd.md` file in VS Code opens it in the ScieMD visual editor by default.

If you previously changed your VS Code editor association for Markdown files, or
if another extension has already claimed Markdown as its default editor, use one
of these fallback workflows.

Explorer fallback:

1. In the VS Code Explorer, find your `.md`, `.markdown`, `.scie.md`, or `.sciemd.md` file.
2. Right-click the file.
3. Select **Open With ScieMD**.

If the Markdown file is already open in another editor:

1. Right-click in the editor title area or use the editor context menu.
2. Select **Open With ScieMD**.

Command Palette workflow:

1. Open a Markdown file.
2. Press `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
3. Search for **Open With ScieMD**.
4. Run the command.

VS Code's built-in **Reopen Editor With...** command may also show **ScieMD
Markdown Editor** as an available editor for Markdown files.

Once the file is open in ScieMD:

1. Use visual mode when you want to write and read like a document.
2. Switch to source mode when you want direct Markdown control.
3. Use the style selector to move between scientific, journal, lab notebook, and
   other visual modes.
4. Add notes when a specific passage needs external LLM help.
5. Open the Data panel when you want to inspect variables or insert a new variable.
6. Create text versions when you want to compare alternate titles, abstracts, or
   paragraph revisions.
7. Save normally with VS Code.

The Markdown file remains the source of truth. Edits made in the ScieMD webview are
written back to the VS Code text document, so normal save, dirty state, undo/redo,
and external document change behavior still follow VS Code's editor model.

## Install The Desktop App

Many users should start with the desktop app rather than the extension.

1. Open https://github.com/scienfy/scie-md/releases/latest
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
5. Open a Markdown file. VS Code opens it with ScieMD by default.

Command-line installation:

```bash
code --install-extension sciemd-vscode-1.0.12.vsix --force
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
- Variable expansion, with variable insertion available from the Data panel.
- Note insertion for external LLM review.
- Text version insertion.
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

https://github.com/scienfy/scie-md

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

```bash
npm install
npm run test
npm run build
npm run package
```

The package command creates `sciemd-vscode-1.0.12.vsix` in this folder.
