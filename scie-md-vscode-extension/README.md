# ScieMD VS Code Extension

This folder is an isolated VS Code extension package for ScieMD. The desktop app files are not edited by this package; reusable code is copied into `src/scie-md` and adapted inside this dedicated folder.

## Architecture

- `src/extension` is the VS Code adapter. It registers `CustomTextEditorProvider` for Markdown, applies edits through `WorkspaceEdit`, handles save/dirty state, watches document changes, and owns clipboard/file-system commands.
- `src/webview` is the VS Code webview host for the ScieMD editor. It communicates with the extension only through typed messages.
- `src/scie-md` is the copied ScieMD app/editor core used by the webview, including the real Milkdown/ProseMirror visual editor, CodeMirror source editor, Markdown/domain logic, and ScieMD document styles.
- `src/shared` keeps the earlier shared Markdown/LLM utilities used by the extension host and tests.

The Markdown file remains the source of truth. Webview edits are applied to the VS Code text document, so VS Code save, dirty state, undo/redo, and external document change notifications stay in the normal editor model.

## Implemented MVP Scope

- Custom editor for `.md`, `.scie.md`, and `.sciemd.md`.
- Real ScieMD visual editor surface using the copied Milkdown/ProseMirror editor and copied ScieMD styles/fonts.
- Source mode using the copied ScieMD CodeMirror editor.
- Visual style selector using the copied ScieMD style presets: Scientific Draft, Journal Manuscript, Lab Notebook, Technical Code, Codex, Scienfy, Science, Nature, and Claude.
- Theme selector with `VS Code` as the default, resolving to the active VS Code light or dark webview theme. Manual Light, Dark, and Sepia overrides are also available.
- Variable expansion and variable insertion.
- Note to LLM and Note to Human insertion using ScieMD note comments.
- Text Version insertion using ScieMD variant comments.
- Save/writeback through VS Code documents.
- External document change detection with review/merge path.
- Commands:
  - `Open With ScieMD Markdown Editor`
  - `Copy ScieMD LLM Skill`
  - `Generate ScieMD_LLM_skill.md Beside Document`

## Build And Test

```powershell
npm install
npm run test
npm run build
npm run package
```

The package command creates `sciemd-vscode-1.0.0.vsix` in this folder.

## Install The VSIX

From VS Code:

1. Open Extensions.
2. Choose Views and More Actions.
3. Choose Install from VSIX.
4. Select `sciemd-vscode-1.0.0.vsix`.
5. Reload VS Code if prompted.

From a terminal:

```powershell
code --install-extension .\sciemd-vscode-1.0.0.vsix --force
```

Then open a Markdown file and run `Open With ScieMD Markdown Editor` from the command palette, editor title context menu, or Explorer context menu.

## MVP Limitations

- This package intentionally avoids Tauri APIs. Tauri dialogs, desktop recent files, export flows, Inkscape actions, and desktop-only settings are not active in the VS Code extension.
- Citations, references, blocks, images, and export UX are not part of this first VS Code editor surface.
- The copied ScieMD mirror should be periodically refreshed from desktop source with explicit review of VS Code shims.
- The extension reuses copied ScieMD code, not live imports from the desktop app. Core editor/parser/style behavior should remain close, but VS Code adapter behavior can still have separate risks around webview CSP, document sync, URI handling, theme mapping, and Tauri shims.
- Marketplace publishing still needs publisher ownership, icon/banner assets, final naming, signing/release workflow, and extension QA on Windows/macOS/Linux.
