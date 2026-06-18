import { useEffect, useState } from 'react';
import type { DocumentInsights } from '../../markdown/documentIntelligence';
import { resolveRelativeMarkdownAsset } from '../../markdown/documentIntelligence';
import { statFile } from '../../services/fileService';
import { isTauriRuntime } from '../runtime';

export function useMissingImageDetection(filePath: string | null, imageReferences: DocumentInsights['imageReferences']): number {
  const [missingImageCount, setMissingImageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!isTauriRuntime() || !filePath || imageReferences.length === 0) {
      setMissingImageCount(0);
      return undefined;
    }

    void Promise.all(imageReferences.map(async (reference) => {
      const resolved = resolveRelativeMarkdownAsset(filePath, reference.url);
      if (!resolved) return false;
      try {
        await statFile(resolved, { contentHash: false });
        return false;
      } catch {
        return true;
      }
    })).then((missing) => {
      if (!cancelled) setMissingImageCount(missing.filter(Boolean).length);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, imageReferences]);

  return missingImageCount;
}
