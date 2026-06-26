import { useCallback, useEffect, useRef, useState } from 'react';
import { listReadableFiles, pickFolder } from '../../services/fileService';
import type { FileExplorerEntry } from '../../services/fileService';
import { clearWatchedFiles, listenFileWatchChanges, updateWatchedFiles } from '../../services/fileWatchService';
import { isTauriRuntime } from '../runtime';

const VISIBLE_DIRECTORY_LOAD_TIMEOUT_MS = 15_000;
const SILENT_DIRECTORY_LOAD_TIMEOUT_MS = 30_000;
type LoadDirectoryOptions = { silent?: boolean; suppressError?: boolean };

interface UseFileExplorerOptions {
  initialPath: string | null;
  onPersistPath: (path: string) => void;
  onOpenDocument: (path: string) => void;
}

export function useFileExplorer({ initialPath, onPersistPath, onOpenDocument }: UseFileExplorerOptions) {
  const loadedInitialPathRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const visibleLoadRequestRef = useRef(0);
  const watchScopeRef = useRef(`explorer:${Math.random().toString(36).slice(2)}`);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileExplorerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

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
        listReadableFiles(path),
        silent ? SILENT_DIRECTORY_LOAD_TIMEOUT_MS : VISIBLE_DIRECTORY_LOAD_TIMEOUT_MS,
        'Folder loading took too long. Try choosing the folder again.',
      );
      if (requestId !== loadRequestRef.current) return;
      loadedInitialPathRef.current = path;
      setCurrentPath(path);
      setEntries(nextEntries);
      onPersistPath(path);
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      if (loadError instanceof DirectoryLoadTimeoutError) {
        loadRequestRef.current += 1;
      }
      if (suppressError) {
        setError(null);
        setEntries([]);
        setCurrentPath((current) => current === path ? null : current);
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Could not read this folder.');
      setEntries([]);
    } finally {
      if (!silent && visibleLoadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [onPersistPath]);

  const chooseFolder = useCallback(async () => {
    try {
      const selectedFolder = await pickFolder();
      if (!selectedFolder) return;
      await loadDirectory(selectedFolder);
    } catch (folderError) {
      console.warn('File explorer folder picker failed.', folderError);
      setError(folderError instanceof Error ? folderError.message : 'Could not choose this folder.');
    }
  }, [loadDirectory]);

  useEffect(() => {
    if (!initialPath || loadedInitialPathRef.current === initialPath) return;
    void loadDirectory(initialPath, { silent: true, suppressError: true }).catch((error) => {
      console.warn('Initial file explorer folder could not be loaded.', error);
    });
  }, [initialPath, loadDirectory]);

  useEffect(() => {
    if (!currentPath) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let reloadTimer: number | null = null;
    let pollTimer: number | null = null;
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
      pollTimer = window.setInterval(refresh, 30_000);
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

    if (isTauriRuntime()) {
      void listenFileWatchChanges((event) => {
        if (event.paths.length === 0 || event.paths.some((path) => pathInsideDirectory(path, currentPath))) {
          scheduleRefresh();
        }
      }).then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      }).catch((error) => {
        console.warn('File explorer watcher listener failed.', error);
        if (!disposed) startFallbackPolling();
      });
      void updateWatchedFiles(watchScopeRef.current, [currentPath]).then((active) => {
        if (!active && !disposed) startFallbackPolling();
      }).catch((error) => {
        console.warn('File explorer watcher update failed.', error);
        if (!disposed) startFallbackPolling();
      });
    } else {
      startFallbackPolling();
    }

    return () => {
      disposed = true;
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      unlisten?.();
      void clearWatchedFiles(watchScopeRef.current).catch((error) => {
        console.warn('File explorer watcher cleanup failed.', error);
      });
    };
  }, [currentPath, loadDirectory]);

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
