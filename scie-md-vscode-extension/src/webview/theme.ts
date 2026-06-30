import { useEffect, useState } from 'react';

export type VscodeThemeMode = 'vscode' | 'light' | 'dark' | 'sepia';
export type ResolvedVscodeTheme = 'light' | 'dark' | 'sepia';

interface ClassContains {
  contains(token: string): boolean;
}

export function normalizeThemeMode(value: unknown): VscodeThemeMode {
  return value === 'light' || value === 'dark' || value === 'sepia' || value === 'vscode'
    ? value
    : 'dark';
}

export function resolveVscodeWorkbenchThemeFromClassList(
  classList: ClassContains,
  fallbackPrefersLight: boolean,
): 'light' | 'dark' {
  if (classList.contains('vscode-light') || classList.contains('vscode-high-contrast-light')) return 'light';
  if (classList.contains('vscode-dark') || classList.contains('vscode-high-contrast')) return 'dark';
  return fallbackPrefersLight ? 'light' : 'dark';
}

export function resolveVscodeWorkbenchTheme(): 'light' | 'dark' {
  return resolveVscodeWorkbenchThemeFromClassList(
    document.body.classList,
    Boolean(window.matchMedia?.('(prefers-color-scheme: light)').matches),
  );
}

export function useResolvedVscodeTheme(themeMode: VscodeThemeMode): ResolvedVscodeTheme {
  const [vscodeTheme, setVscodeTheme] = useState(resolveVscodeWorkbenchTheme);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setVscodeTheme(resolveVscodeWorkbenchTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (themeMode === 'vscode') return vscodeTheme;
  return themeMode;
}
