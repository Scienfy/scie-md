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
  const checkVersionRef = useRef(0);
  const filePathRef = useRef(filePath);
  const fileMetadataRef = useRef(fileMetadata);
  const getCurrentMarkdownRef = useRef(getCurrentMarkdown);
  const onConflictRef = useRef(onConflict);
  const onCloudPlaceholderRef = useRef(onCloudPlaceholder);

  useEffect(() => {
    checkVersionRef.current += 1;
    filePathRef.current = filePath;
    fileMetadataRef.current = fileMetadata;
  }, [fileMetadata.contentHash, fileMetadata.lastKnownMtimeMs, fileMetadata.lastKnownSizeBytes, filePath]);

  useEffect(() => {
    getCurrentMarkdownRef.current = getCurrentMarkdown;
  }, [getCurrentMarkdown]);

  useEffect(() => {
    onConflictRef.current = onConflict;
  }, [onConflict]);

  useEffect(() => {
    onCloudPlaceholderRef.current = onCloudPlaceholder;
  }, [onCloudPlaceholder]);

  const checkExternalChange = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    const currentFilePath = filePathRef.current;
    const currentFileMetadata = fileMetadataRef.current;
    if (!currentFilePath || currentFileMetadata.lastKnownMtimeMs === 0) return;
    const checkVersion = checkVersionRef.current;
    const isCurrentCheck = () => checkVersionRef.current === checkVersion;
    try {
      let currentMetadata = await statFile(currentFilePath, { contentHash: false });
      if (!isCurrentCheck()) return;
      if (isCloudPlaceholderState(currentMetadata.cloudState)) {
        const message = 'This document is in a cloud placeholder state. ScieMD will wait for the file to be fully available before raising disk-conflict warnings.';
        if (message !== lastCloudWarningRef.current) {
          lastCloudWarningRef.current = message;
          onCloudPlaceholderRef.current?.(message);
        }
        return;
      }
      if (!metadataChanged(currentFileMetadata, currentMetadata) && currentFileMetadata.contentHash) {
        currentMetadata = await statFile(currentFilePath, { contentHash: true });
        if (!isCurrentCheck()) return;
      }
      if (metadataChanged(currentFileMetadata, currentMetadata)) {
        const disk = await readTextFile(currentFilePath).catch(() => null);
        if (!isCurrentCheck()) return;
        if (disk?.content === getCurrentMarkdownRef.current()) return;
        onConflictRef.current();
      }
    } catch {
      if (isCurrentCheck()) onConflictRef.current();
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      void checkExternalChange().catch((error) => {
        console.warn('External document change check failed.', error);
      });
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
      }).catch((error) => {
        console.warn('External document watcher listener failed.', error);
        if (!disposed) startFallbackPolling();
      });
      void updateWatchedFiles(watchScopeRef.current, [filePath]).then((active) => {
        if (!active && !disposed) startFallbackPolling();
      }).catch((error) => {
        console.warn('External document watcher update failed.', error);
        if (!disposed) startFallbackPolling();
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', handler);
      unlisten?.();
      if (fallbackInterval !== null) window.clearInterval(fallbackInterval);
      void clearWatchedFiles(watchScopeRef.current).catch((error) => {
        console.warn('External document watcher cleanup failed.', error);
      });
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
  let normalized = path.trim();
  if (/^\\\\\?\\UNC\\/i.test(normalized)) {
    normalized = `\\\\${normalized.slice('\\\\?\\UNC\\'.length)}`;
  } else if (/^\\\\\?\\/i.test(normalized)) {
    normalized = normalized.slice('\\\\?\\'.length);
  }
  normalized = normalized.replace(/\\/g, '/');
  const isUncPath = normalized.startsWith('//');
  normalized = normalized.replace(/\/+/g, '/');
  if (isUncPath && !normalized.startsWith('//')) normalized = `/${normalized}`;
  return normalized.toLocaleLowerCase();
}
