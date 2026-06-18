import { useCallback, useEffect, useRef } from 'react';
import type { FileMetadata } from '../documentState';
import { metadataChanged } from '../documentState';
import { readTextFile, statFile } from '../../services/fileService';
import { clearWatchedFiles, listenFileWatchChanges, updateWatchedFiles } from '../../services/fileWatchService';
import { isTauriRuntime } from '../runtime';

interface UseExternalChangeDetectionOptions {
  filePath: string | null;
  fileMetadata: FileMetadata;
  getCurrentMarkdown: () => string;
  onConflict: () => void;
  onCloudPlaceholder?: (message: string) => void;
}

export function useExternalChangeDetection({ filePath, fileMetadata, getCurrentMarkdown, onConflict, onCloudPlaceholder }: UseExternalChangeDetectionOptions) {
  const watchScopeRef = useRef(`document:${Math.random().toString(36).slice(2)}`);
  const lastCloudWarningRef = useRef('');

  const checkExternalChange = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    if (!filePath || fileMetadata.lastKnownMtimeMs === 0) return;
    try {
      let currentMetadata = await statFile(filePath, { contentHash: false });
      if (isCloudPlaceholderState(currentMetadata.cloudState)) {
        const message = 'This document is in a cloud placeholder state. ScieMD will wait for the file to be fully available before raising disk-conflict warnings.';
        if (message !== lastCloudWarningRef.current) {
          lastCloudWarningRef.current = message;
          onCloudPlaceholder?.(message);
        }
        return;
      }
      if (!metadataChanged(fileMetadata, currentMetadata) && fileMetadata.contentHash) {
        currentMetadata = await statFile(filePath, { contentHash: true });
      }
      if (metadataChanged(fileMetadata, currentMetadata)) {
        const disk = await readTextFile(filePath).catch(() => null);
        if (disk?.content === getCurrentMarkdown()) return;
        onConflict();
      }
    } catch {
      onConflict();
    }
  }, [fileMetadata, filePath, getCurrentMarkdown, onCloudPlaceholder, onConflict]);

  useEffect(() => {
    const handler = () => {
      void checkExternalChange();
    };
    let fallbackInterval: number | null = null;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const startFallbackPolling = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(handler, 30_000);
    };

    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', handler);
    startFallbackPolling();
    if (filePath && isTauriRuntime()) {
      void listenFileWatchChanges((event) => {
        if (event.paths.length === 0 || event.paths.some((path) => samePath(path, filePath))) {
          handler();
        }
      }).then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      });
      void updateWatchedFiles(watchScopeRef.current, [filePath]).then((active) => {
        if (!active && !disposed) startFallbackPolling();
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', handler);
      unlisten?.();
      if (fallbackInterval !== null) window.clearInterval(fallbackInterval);
      void clearWatchedFiles(watchScopeRef.current);
    };
  }, [checkExternalChange, filePath]);

  return checkExternalChange;
}

function isCloudPlaceholderState(state: FileMetadata['cloudState'] | undefined): boolean {
  return state === 'cloud-placeholder' || state === 'cloud-recall-on-open';
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLocaleLowerCase();
}
