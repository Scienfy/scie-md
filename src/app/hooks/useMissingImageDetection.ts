import { useEffect, useState } from 'react';
import type { DocumentInsights } from '../../markdown/documentIntelligence';
import { resolveRelativeMarkdownAsset } from '../../markdown/documentIntelligence';
import { statFile, syncDocumentImageGrants } from '../../services/fileService';
import { isTauriRuntime } from '../runtime';

export function useMissingImageDetection(filePath: string | null, imageReferences: DocumentInsights['imageReferences']): number {
  const [missingImageCount, setMissingImageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!isTauriRuntime() || !filePath) {
      setMissingImageCount(0);
      return undefined;
    }

    const imageUrls = Array.from(new Set(imageReferences.map((reference) => reference.url)));
    if (imageUrls.length === 0) {
      void syncDocumentImageGrants(filePath, []).catch(() => undefined);
      setMissingImageCount(0);
      return undefined;
    }

    void (async () => {
      await syncDocumentImageGrants(filePath, imageUrls);
      return Promise.all(imageReferences.map(async (reference) => {
        const resolved = resolveRelativeMarkdownAsset(filePath, reference.url);
        if (!resolved) return false;
        try {
          await statFile(resolved, { contentHash: false });
          return false;
        } catch {
          return true;
        }
      }));
    })().then((missing) => {
      if (!cancelled) setMissingImageCount(missing.filter(Boolean).length);
    }).catch(() => {
      if (!cancelled) setMissingImageCount(0);
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, imageReferences]);

  useEffect(() => {
    if (!isTauriRuntime() || !filePath) return undefined;
    return () => {
      void syncDocumentImageGrants(filePath, []).catch(() => undefined);
    };
  }, [filePath]);

  return missingImageCount;
}
