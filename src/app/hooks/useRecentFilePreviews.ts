import { useEffect, useMemo, useState } from 'react';
import { basename } from '../documentState';
import { createRecentFilePreview } from '../../markdown/documentIntelligence';
import type { RecentFilePreview } from '../../markdown/documentIntelligence';
import { readTextFilePreview } from '../../services/fileService';
import { isTauriRuntime } from '../runtime';

export function useRecentFilePreviews(recentFiles: string[]): RecentFilePreview[] {
  const recentFilesKey = useMemo(() => recentFiles.join('|'), [recentFiles]);
  const fallbackPreviews = useMemo(() => {
    const paths = recentFilesKey ? recentFilesKey.split('|') : [];
    return paths.map((recentPath) => createRecentFilePreview(
      recentPath,
      `# ${basename(recentPath)}\n\n${recentPath}`,
    ));
  }, [recentFilesKey]);
  const [previews, setPreviews] = useState<RecentFilePreview[]>(fallbackPreviews);

  useEffect(() => {
    setPreviews(fallbackPreviews);
    if (!isTauriRuntime() || fallbackPreviews.length === 0) return undefined;
    let cancelled = false;
    void Promise.all(fallbackPreviews.map(async (fallback) => {
      try {
        const preview = await readTextFilePreview(fallback.path, 8192);
        return createRecentFilePreview(fallback.path, preview.content, preview.modifiedMs);
      } catch {
        return fallback;
      }
    })).then((loaded) => {
      if (!cancelled) setPreviews(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [fallbackPreviews]);

  return previews;
}
