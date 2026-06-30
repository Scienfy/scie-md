import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const extensionRoot = process.cwd();
const webviewStyles = readFileSync(join(extensionRoot, 'src/webview/styles.css'), 'utf8');
const scieStyleRoot = join(extensionRoot, 'src/scie-md/styles');
const extensionTokenStyles = readFileSync(join(scieStyleRoot, 'app.tokens.css'), 'utf8');
const desktopStyleFiles = readdirSync(scieStyleRoot)
  .filter((fileName) => fileName.endsWith('.css'))
  .sort();
const allExtensionCss = [
  webviewStyles,
  ...desktopStyleFiles.map((fileName) => readFileSync(join(scieStyleRoot, fileName), 'utf8')),
].join('\n');

function definedCustomProperties(css: string): Set<string> {
  return new Set(
    Array.from(css.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g), (match) => match[1]),
  );
}

function referencedCustomProperties(css: string): Set<string> {
  return new Set(
    Array.from(css.matchAll(/var\(\s*(--[\w-]+)/g), (match) => match[1]),
  );
}

describe('VS Code webview CSS token bridge', () => {
  it('documents the host-owned bridge and maps VS Code mode into desktop ScieMD tokens', () => {
    expect(webviewStyles).toContain('VS Code-to-ScieMD token bridge');
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="vscode"\]\s*{[\s\S]*--surface:\s*var\(--scie-widget\);/);
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="vscode"\]\s*{[\s\S]*--text:\s*var\(--scie-fg\);/);
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="vscode"\]\s*{[\s\S]*--accent:\s*var\(--scie-primary-bg\);/);
  });

  it('maps selected desktop modes back to the extension shell token names', () => {
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="light"\],[\s\S]*:root\[data-theme-mode="sepia"\]\s*{[\s\S]*--scie-bg:\s*var\(--bg\);/);
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="light"\],[\s\S]*:root\[data-theme-mode="sepia"\]\s*{[\s\S]*--scie-fg:\s*var\(--text\);/);
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="light"\],[\s\S]*:root\[data-theme-mode="sepia"\]\s*{[\s\S]*--scie-primary-bg:\s*var\(--accent\);/);
  });

  it('keeps explicit light and sepia chrome controls readable and intentionally disabled', () => {
    const lightSepiaBridge = /:root\[data-theme-mode="light"\],[\s\S]*:root\[data-theme-mode="sepia"\]\s*{([\s\S]*?)\n}/.exec(webviewStyles)?.[1] ?? '';

    expect(lightSepiaBridge).toContain('--scie-button-fg: var(--text);');
    expect(lightSepiaBridge).toContain('--scie-control-bg: var(--button-bg);');
    expect(lightSepiaBridge).toContain('--scie-control-fg: var(--text);');
    expect(lightSepiaBridge).toContain('--scie-control-disabled-bg: color-mix(in srgb, var(--surface-soft) 74%, var(--surface));');
    expect(lightSepiaBridge).toContain('--scie-control-disabled-fg: color-mix(in srgb, var(--text-muted) 82%, var(--surface));');
    expect(webviewStyles).toMatch(/:root\[data-theme-mode="light"\]\s*{[\s\S]*--scie-control-selected-bg:\s*#2f6375;/);
    expect(webviewStyles).toMatch(/button,\s*select\s*{[\s\S]*background:\s*var\(--scie-control-bg\);[\s\S]*color:\s*var\(--scie-control-fg\);/);
    expect(webviewStyles).toMatch(/button:disabled,\s*select:disabled\s*{[\s\S]*background:\s*var\(--scie-control-disabled-bg\);[\s\S]*color:\s*var\(--scie-control-disabled-fg\);[\s\S]*opacity:\s*1;/);
    expect(webviewStyles).toMatch(/button\.selected:not\(:disabled\),\s*button\[type="submit"\]:not\(:disabled\)\s*{[\s\S]*background:\s*var\(--scie-control-selected-bg\);[\s\S]*color:\s*var\(--scie-control-selected-fg\);/);
    expect(webviewStyles).toMatch(/\.vscode-scie-mode-toggle button\s*{[\s\S]*color:\s*var\(--scie-control-fg\);/);
    expect(webviewStyles).toMatch(/\.vscode-scie-choice-button,[\s\S]*\.vscode-scie-tool-button\s*{[\s\S]*background:\s*var\(--scie-control-bg\);[\s\S]*color:\s*var\(--scie-control-fg\);/);
  });

  it('defines every extension CSS custom property reference except VS Code host variables', () => {
    const definitions = definedCustomProperties(allExtensionCss);
    const missing = Array.from(referencedCustomProperties(allExtensionCss))
      .filter((propertyName) => !propertyName.startsWith('--vscode-'))
      .filter((propertyName) => !definitions.has(propertyName))
      .sort();

    expect(missing).toEqual([]);
  });

  it('keeps the forced-colors bridge complete for shared desktop components', () => {
    const forcedColorsBlock = webviewStyles.match(/@media \(forced-colors: active\) \{([\s\S]*)\}\s*$/)?.[1] ?? '';

    expect(forcedColorsBlock).toContain('--text-strong: CanvasText;');
    expect(forcedColorsBlock).toContain('--border-strong: ButtonBorder;');
    expect(forcedColorsBlock).toContain('--accent-contrast: HighlightText;');
    expect(forcedColorsBlock).toContain('--focus-ring: Highlight;');
    expect(forcedColorsBlock).toContain('--scie-control-fg: ButtonText;');
    expect(forcedColorsBlock).toContain('--scie-control-selected-bg: Highlight;');
    expect(forcedColorsBlock).toContain('--scie-control-disabled-fg: GrayText;');
  });

  it('keeps extension font-face URLs relative to the packaged webview CSS bundle', () => {
    expect(extensionTokenStyles).not.toMatch(/url\(\s*['"]?\/fonts\//);
    expect(extensionTokenStyles).toMatch(/url\(\s*['"]?\.\/fonts\//);
  });

  it('keeps the data sidebar from crushing narrow VS Code panes', () => {
    expect(webviewStyles).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.vscode-scie-content\[data-data-sidebar-open="true"\]\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(webviewStyles).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.vscode-scie-data-sidebar\s*{[\s\S]*position:\s*absolute;/);
  });
});
