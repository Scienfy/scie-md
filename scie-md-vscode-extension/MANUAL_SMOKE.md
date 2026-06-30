# ScieMD VS Code Extension Manual Smoke

Use this checklist after `npm run package:vscode` when a real VS Code host check is needed in addition to the automated webview smoke.

## Install

1. Close existing ScieMD extension development windows.
2. From this folder, install the current package:

```powershell
code --install-extension .\sciemd-vscode-1.0.12.vsix --force
```

3. Reload VS Code.
4. Open a scratch workspace with a Markdown file that has at least four headings, one image link, one note marker, one variable, and one text-version block.

## Visual Matrix

Run these checks in the ScieMD custom editor:

- Dark VS Code theme: topbar, toolbar, style/theme menus, quick outline, sidebar, review cards, and modal text are readable.
- Light VS Code theme: the same surfaces keep contrast and no native OS dropdown appears.
- High Contrast theme: focus rings, selected tabs, buttons, and review cards remain visible.
- Narrow editor width: topbar wraps cleanly, style/theme menus stay inside the webview, sidebar becomes an overlay, and the editor is not crushed.
- Long file name: the title truncates with an ellipsis and does not push controls out of view.
- Floating quick outline: hover/focus opens the outline card and clicking a heading jumps in visual mode.
- Persistent outline sidebar: open, narrow, widen, close, and heading jump work in visual and source mode.
- Read-only state: save and insert controls are disabled, while style/theme and outline controls remain usable.

## Host Behavior

- Open the same Markdown file in two ScieMD panels and a normal VS Code text editor.
- Edit in one ScieMD panel, then save from the other after the first edit lands; the stale panel should refresh or report a skipped operation instead of overwriting.
- Edit the Markdown in the normal text editor while the ScieMD panel is open; the external-change review should show readable cards for small changes and collapsed cards for large changes.
- Use undo and redo after a visual edit; pending webview edits should flush before VS Code command execution.
- Run **Copy ScieMD LLM Skill** and **Generate ScieMD_LLM_skill.md Beside Document** from the editor and command palette.
- Reopen the custom editor after closing the panel; the document should reload with the latest Markdown and preserved extension UI state where expected.

## Package Gate

Before calling the VSIX release-ready, rerun the automated host/webview smoke and package gates:

```powershell
npm run validate:vscode-host-smoke
npm run validate:vscode-visual-smoke
npm run package:vscode
npm run validate:vscode-package
npm run validate:vscode-installed-smoke -- --required
```
