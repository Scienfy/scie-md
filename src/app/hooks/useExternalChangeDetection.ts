import { useCallback, useEffect, useRef } from 'react';
import type { FileMetadata } from '../documentState';
import { metadataChanged } from '../documentState';
import { isTauriRuntime } from '../runtime';
import type { DocumentHost } from '../host/documentHost';
import { fileWatchRetryDelayMs } from '../../services/fileWatchService';

interface UseExternalChangeDetectionOptions {
  filePath: string | null;
  fileMetadata: FileMetadata;
  getCurrentSourceText: () => string;
  onConflict: () => void;
  onSyncedExternalChange?: (path: string, content: string, metadata: FileMetadata) => void;
  onCloudPlaceholder?: (message: string) => void;
  host: Pick<DocumentHost, 'file' | 'watcher'>;
}

export function useExternalChangeDetection({
  filePath,
  fileMetadata,
  getCurrentSourceText,
  onConflict,
  onSyncedExternalChange,
  onCloudPlaceholder,
  host,
}: UseExternalChangeDetectionOptions) {
  const watchScopeRef = useRef(`document:${Math.random().toString(36).slice(2)}`);
  const lastCloudWarningRef = useRef('');
  const checkVersionRef = useRef(0);
  const filePathRef = useRef(filePath);
  const fileMetadataRef = useRef(fileMetadata);
  const getCurrentSourceTextRef = useRef(getCurrentSourceText);
  const onConflictRef = useRef(onConflict);
  const onSyncedExternalChangeRef = useRef(onSyncedExternalChange);
  const onCloudPlaceholderRef = useRef(onCloudPlaceholder);
  const checkInFlightRef = useRef(false);
  const checkQueuedRef = useRef(false);

  useEffect(() => {
    checkVersionRef.current += 1;
    filePathRef.current = filePath;
    fileMetadataRef.current = fileMetadata;
  }, [fileMetadata.contentHash, fileMetadata.lastKnownMtimeMs, fileMetadata.lastKnownSizeBytes, filePath]);

  useEffect(() => {
    getCurrentSourceTextRef.current = getCurrentSourceText;
  }, [getCurrentSourceText]);

  useEffect(() => {
    onConflictRef.current = onConflict;
  }, [onConflict]);

  useEffect(() => {
    onSyncedExternalChangeRef.current = onSyncedExternalChange;
  }, [onSyncedExternalChange]);

  useEffect(() => {
    onCloudPlaceholderRef.current = onCloudPlaceholder;
  }, [onCloudPlaceholder]);

  const runExternalChangeCheck = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    const currentFilePath = filePathRef.current;
    const currentFileMetadata = fileMetadataRef.current;
    if (!currentFilePath || currentFileMetadata.lastKnownMtimeMs === 0) return;
    const checkVersion = checkVersionRef.current;
    const isCurrentCheck = () => checkVersionRef.current === checkVersion;
    try {
      let currentMetadata = await host.file.statFile(currentFilePath, { contentHash: false });
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
        currentMetadata = await host.file.statFile(currentFilePath, { contentHash: true });
        if (!isCurrentCheck()) return;
      }
      if (metadataChanged(currentFileMetadata, currentMetadata)) {
        const disk = await host.file.readTextFile(currentFilePath).catch(() => null);
        if (!isCurrentCheck()) return;
        if (disk?.content === getCurrentSourceTextRef.current()) {
          onSyncedExternalChangeRef.current?.(currentFilePath, disk.content, disk.metadata);
          return;
        }
        onConflictRef.current();
      }
    } catch {
      if (isCurrentCheck()) onConflictRef.current();
    }
  }, [host]);

  const checkExternalChange = useCallback(async () => {
    if (checkInFlightRef.current) {
      checkQueuedRef.current = true;
      return;
    }
    checkInFlightRef.current = true;
    try {
      do {
        checkQueuedRef.current = false;
        await runExternalChangeCheck();
      } while (checkQueuedRef.current);
    } finally {
      checkInFlightRef.current = false;
    }
  }, [runExternalChangeCheck]);

  useEffect(() => {
    const handler = () => {
      void checkExternalChange().catch((error) => {
        console.warn('External document change check failed.', error);
      });
    };
    let fallbackInterval: number | null = null;
    let retryTimer: number | null = null;
    let watchFailureCount = 0;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const startFallbackPolling = () => {
      if (fallbackInterval !== null) return;
      handler();
      fallbackInterval = window.setInterval(handler, 30_000);
    };
    const stopFallbackPolling = () => {
      if (fallbackInterval === null) return;
      window.clearInterval(fallbackInterval);
      fallbackInterval = null;
    };
    const scheduleWatchRetry = () => {
      if (retryTimer !== null || disposed || !filePath || !isTauriRuntime()) return;
      watchFailureCount += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void activateWatcher();
      }, fileWatchRetryDelayMs(watchFailureCount));
    };
    const activateWatcher = async () => {
      if (disposed || !filePath || !isTauriRuntime()) return;
      try {
        if (!unlisten) {
          const dispose = await host.watcher.listenFileWatchChanges((event) => {
            if (event.paths.length === 0 || event.paths.some((path) => samePath(path, filePath))) {
              handler();
            }
          });
          if (disposed) {
            dispose();
            return;
          }
          unlisten = dispose;
        }
      } catch (error) {
        console.warn('External document watcher listener failed.', error);
        if (!disposed) {
          startFallbackPolling();
          scheduleWatchRetry();
        }
        return;
      }
      try {
        const active = await host.watcher.updateWatchedFiles(watchScopeRef.current, [filePath]);
        if (disposed) return;
        if (active) {
          watchFailureCount = 0;
          stopFallbackPolling();
          handler();
        } else {
          startFallbackPolling();
          scheduleWatchRetry();
        }
      } catch (error) {
        console.warn('External document watcher update failed.', error);
        if (!disposed) {
          startFallbackPolling();
          scheduleWatchRetry();
        }
      }
    };

    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', handler);
    if (!filePath || !isTauriRuntime()) {
      startFallbackPolling();
    } else {
      void activateWatcher();
    }

    return () => {
      disposed = true;
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', handler);
      unlisten?.();
      if (fallbackInterval !== null) window.clearInterval(fallbackInterval);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      void host.watcher.clearWatchedFiles(watchScopeRef.current).catch((error) => {
        console.warn('External document watcher cleanup failed.', error);
      });
    };
  }, [checkExternalChange, filePath, host]);

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
