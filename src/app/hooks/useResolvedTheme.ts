import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../services/settingsService';
import type { VisualStyleId } from '../../services/visualStyleService';

export function useThemeAttribute(themeMode: ThemeMode) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const resolvedTheme = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  return resolvedTheme;
}

export function useLayoutAttributes(fontScale: number, visualStyle: VisualStyleId) {
  useEffect(() => {
    document.documentElement.dataset.visualStyle = visualStyle;
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
  }, [fontScale, visualStyle]);
}
