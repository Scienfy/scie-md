import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileExplorerEntry } from '../../services/fileService';
import { fileWatchRetryDelayMs } from '../../services/fileWatchService';
import { desktopPlatformHost } from '../host/desktopPlatformHost';
import type { DesktopPlatformHost } from '../host/platformHost';

const VISIBLE_DIRECTORY_LOAD_TIMEOUT_MS = 15_000;
const SILENT_DIRECTORY_LOAD_TIMEOUT_MS = 30_000;
const EXPLORER_WATCH_DEGRADED_MESSAGE = 'Folder changes are being checked periodically because native folder watching is unavailable.';
type LoadDirectoryOptions = { silent?: boolean; suppressError?: boolean };

interface UseFileExplorerOptions {
  initialPath: string | null;
  fallbackInitialPath?: string | null;
  onPersistPath: (path: string) => void;
  onOpenDocument: (path: string) => void;
  platformHost?: DesktopPlatformHost;
}

export function useFileExplorer({
  initialPath,
  fallbackInitialPath = null,
  onPersistPath,
  onOpenDocument,
  platformHost = desktopPlatformHost,
}: UseFileExplorerOptions) {
  const loadedInitialPathRef = useRef<string | null>(null);
  const attemptedInitialPathKeyRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const visibleLoadRequestRef = useRef(0);
  const watchScopeRef = useRef(`explorer:${Math.random().toString(36).slice(2)}`);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileExplorerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [watcherMessage, setWatcherMessage] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string, options: LoadDirectoryOptions = {}) => {
    const requestId = ++loadRequestRef.current;
    const silent = options.silent === true;
    const suppressError = options.suppressError === true;
    if (!silent) {
      visibleLoadRequestRef.current = requestId;
      setLoading(true);
    }
    setError(null);
    if (!silent) setSelectedImage(null);
    try {
      const nextEntries = await withTimeout(
        platformHost.fileBrowser.listReadableFiles(path),
        silent ? SILENT_DIRECTORY_LOAD_TIMEOUT_MS : VISIBLE_DIRECTORY_LOAD_TIMEOUT_MS,
        'Folder loading took too long. Try choosing the folder again.',
      );
      if (requestId !== loadRequestRef.current) return false;
      loadedInitialPathRef.current = path;
      setCurrentPath(path);
      setEntries(nextEntries);
      onPersistPath(path);
      return true;
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return false;
      if (loadError instanceof DirectoryLoadTimeoutError) {
        loadRequestRef.current += 1;
      }
      if (suppressError) {
        setError(null);
        setEntries([]);
        setCurrentPath((current) => current === path ? null : current);
        return false;
      }
      setError(loadError instanceof Error ? loadError.message : 'Could not read this folder.');
      setEntries([]);
      return false;
    } finally {
      if (!silent && visibleLoadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [onPersistPath, platformHost]);

  const chooseFolder = useCallback(async () => {
    try {
      const selectedFolder = await platformHost.fileBrowser.pickFolder();
      if (!selectedFolder) return;
      await loadDirectory(selectedFolder);
    } catch (folderError) {
      console.warn('File explorer folder picker failed.', folderError);
      setError(folderError instanceof Error ? folderError.message : 'Could not choose this folder.');
    }
  }, [loadDirectory, platformHost]);

  useEffect(() => {
    if (!initialPath || loadedInitialPathRef.current === initialPath) return;
    const fallbackPath = fallbackInitialPath?.trim() ? fallbackInitialPath : null;
    const initialKey = `${initialPath}\n${fallbackPath ?? ''}`;
    if (attemptedInitialPathKeyRef.current === initialKey) return;
    attemptedInitialPathKeyRef.current = initialKey;
    void (async () => {
      const loaded = await loadDirectory(initialPath, { silent: true, suppressError: true });
      if (loaded || !fallbackPath || fallbackPath === initialPath) return;
      await loadDirectory(fallbackPath, { silent: true, suppressError: true });
    })().catch((error) => {
      console.warn('Initial file explorer folder could not be loaded.', error);
    });
  }, [fallbackInitialPath, initialPath, loadDirectory]);

  useEffect(() => {
    if (!currentPath) {
      setWatcherMessage(null);
      return undefined;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let reloadTimer: number | null = null;
    let pollTimer: number | null = null;
    let retryTimer: number | null = null;
    let watchFailureCount = 0;
    let refreshInFlight = false;

    const refresh = () => {
      if (disposed || refreshInFlight) return;
      refreshInFlight = true;
      void loadDirectory(currentPath, { silent: true })
        .catch((error) => {
          console.warn('File explorer refresh failed.', error);
        })
        .finally(() => {
          refreshInFlight = false;
        });
    };
    const startFallbackPolling = () => {
      if (pollTimer !== null) return;
      setWatcherMessage(EXPLORER_WATCH_DEGRADED_MESSAGE);
      refresh();
      pollTimer = window.setInterval(refresh, 30_000);
    };
    const stopFallbackPolling = () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      setWatcherMessage(null);
    };
    const scheduleWatchRetry = () => {
      if (retryTimer !== null || disposed) return;
      watchFailureCount += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void activateWatcher();
      }, fileWatchRetryDelayMs(watchFailureCount));
    };
    const activateWatcher = async () => {
      if (disposed) return;
      try {
        if (!unlisten) {
          const dispose = await platformHost.watcher.listenFileWatchChanges((event) => {
            if (event.paths.length === 0 || event.paths.some((path) => pathInsideDirectory(path, currentPath))) {
              scheduleRefresh();
            }
          });
          if (disposed) {
            dispose();
            return;
          }
          unlisten = dispose;
        }
      } catch (error) {
        console.warn('File explorer watcher listener failed.', error);
        if (!disposed) {
          startFallbackPolling();
          scheduleWatchRetry();
        }
        return;
      }
      try {
        const active = await platformHost.watcher.updateWatchedFiles(watchScopeRef.current, [currentPath]);
        if (disposed) return;
        if (active) {
          watchFailureCount = 0;
          stopFallbackPolling();
        } else {
          startFallbackPolling();
          scheduleWatchRetry();
        }
      } catch (error) {
        console.warn('File explorer watcher update failed.', error);
        if (!disposed) {
          startFallbackPolling();
          scheduleWatchRetry();
        }
      }
    };
    const scheduleRefresh = () => {
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        refresh();
      }, 350);
    };
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'hidden') return;
      scheduleRefresh();
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);

    void activateWatcher();

    return () => {
      disposed = true;
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      unlisten?.();
      void platformHost.watcher.clearWatchedFiles(watchScopeRef.current).catch((error) => {
        console.warn('File explorer watcher cleanup failed.', error);
      });
    };
  }, [currentPath, loadDirectory, platformHost]);

  const openEntry = useCallback((entry: FileExplorerEntry) => {
    if (entry.kind === 'directory') {
      void loadDirectory(entry.path).catch((error) => {
        console.warn('File explorer directory open failed.', error);
      });
      return;
    }
    onOpenDocument(entry.path);
  }, [loadDirectory, onOpenDocument]);

  return {
    currentPath,
    entries,
    loading,
    error,
    selectedImage,
    watcherMessage,
    loadDirectory,
    chooseFolder,
    openEntry,
  };
}

function pathInsideDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedDirectory = normalizePath(directory).replace(/\/$/, '');
  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').toLocaleLowerCase();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new DirectoryLoadTimeoutError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

class DirectoryLoadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectoryLoadTimeoutError';
  }
}
