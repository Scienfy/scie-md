import { describe, expect, it } from 'vitest';
import { normalizeThemeMode, resolveVscodeWorkbenchThemeFromClassList } from './theme';

function classList(...tokens: string[]) {
  return {
    contains: (token: string) => tokens.includes(token),
  };
}

describe('VS Code webview theme helpers', () => {
  it('normalizes stored theme modes and defaults invalid values to dark', () => {
    expect(normalizeThemeMode('vscode')).toBe('vscode');
    expect(normalizeThemeMode('light')).toBe('light');
    expect(normalizeThemeMode('dark')).toBe('dark');
    expect(normalizeThemeMode('sepia')).toBe('sepia');
    expect(normalizeThemeMode('system')).toBe('dark');
    expect(normalizeThemeMode(undefined)).toBe('dark');
  });

  it('resolves VS Code workbench light, dark, and high-contrast classes', () => {
    expect(resolveVscodeWorkbenchThemeFromClassList(classList('vscode-light'), false)).toBe('light');
    expect(resolveVscodeWorkbenchThemeFromClassList(classList('vscode-dark'), true)).toBe('dark');
    expect(resolveVscodeWorkbenchThemeFromClassList(classList('vscode-high-contrast'), true)).toBe('dark');
    expect(resolveVscodeWorkbenchThemeFromClassList(classList('vscode-high-contrast-light'), false)).toBe('light');
  });

  it('uses the media fallback only when VS Code has not stamped a theme class', () => {
    expect(resolveVscodeWorkbenchThemeFromClassList(classList(), true)).toBe('light');
    expect(resolveVscodeWorkbenchThemeFromClassList(classList(), false)).toBe('dark');
  });
});
