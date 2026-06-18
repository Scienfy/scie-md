import { useCallback, useEffect, useRef, useState } from 'react';
import { listReadableFiles, pickFolder } from '../../services/fileService';
import type { FileExplorerEntry } from '../../services/fileService';
import { clearWatchedFiles, listenFileWatchChanges, updateWatchedFiles } from '../../services/fileWatchService';
import { isTauriRuntime } from '../runtime';

interface UseFileExplorerOptions {
  initialPath: string | null;
  onPersistPath: (path: string) => void;
  onOpenDocument: (path: string) => void;
}

export function useFileExplorer({ initialPath, onPersistPath, onOpenDocument }: UseFileExplorerOptions) {
  const loadedInitialPathRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const watchScopeRef = useRef(`explorer:${Math.random().toString(36).slice(2)}`);
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath);
  const [entries, setEntries] = useState<FileExplorerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const loadDirectory = useCallback(async (path: string, options: { silent?: boolean } = {}) => {
    const requestId = ++loadRequestRef.current;
    if (!options.silent) setLoading(true);
    setError(null);
    if (!options.silent) setSelectedImage(null);
    try {
      const nextEntries = await listReadableFiles(path);
      if (requestId !== loadRequestRef.current) return;
      setCurrentPath(path);
      setEntries(nextEntries);
      onPersistPath(path);
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      setError(loadError instanceof Error ? loadError.message : 'Could not read this folder.');
      setEntries([]);
    } finally {
      if (requestId === loadRequestRef.current && !options.silent) setLoading(false);
    }
  }, [onPersistPath]);

  const chooseFolder = useCallback(async () => {
    const selectedFolder = await pickFolder();
    if (!selectedFolder) return;
    await loadDirectory(selectedFolder);
  }, [loadDirectory]);

  useEffect(() => {
    if (!initialPath || loadedInitialPathRef.current === initialPath) return;
    loadedInitialPathRef.current = initialPath;
    void loadDirectory(initialPath);
  }, [initialPath, loadDirectory]);

  useEffect(() => {
    if (!currentPath) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let reloadTimer: number | null = null;
    let pollTimer: number | null = null;

    const refresh = () => {
      if (disposed) return;
      void loadDirectory(currentPath, { silent: true });
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
    pollTimer = window.setInterval(refresh, 30_000);

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
      });
      void updateWatchedFiles(watchScopeRef.current, [currentPath]);
    }

    return () => {
      disposed = true;
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      unlisten?.();
      void clearWatchedFiles(watchScopeRef.current);
    };
  }, [currentPath, loadDirectory]);

  const openEntry = useCallback((entry: FileExplorerEntry) => {
    if (entry.kind === 'directory') {
      void loadDirectory(entry.path);
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
