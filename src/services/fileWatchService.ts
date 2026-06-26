import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { isTauriRuntime } from '../app/runtime';

export interface FileWatchChangeEvent {
  paths: string[];
  kind: string;
  changedAtMs: number;
}

const watchedScopes = new Map<string, string[]>();
let appliedWatchKey = '';
let watcherUpdateInFlight: Promise<boolean> | null = null;

export function listenFileWatchChanges(
  handler: (event: FileWatchChangeEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<FileWatchChangeEvent>('scienfy-file-watch-change', (event) => {
    handler(event.payload);
  });
}

export function updateWatchedFiles(scope: string, paths: string[]): Promise<boolean> {
  watchedScopes.set(scope, uniquePaths(paths));
  return applyWatchedFiles();
}

export function clearWatchedFiles(scope: string): Promise<boolean> {
  watchedScopes.delete(scope);
  return applyWatchedFiles();
}

function applyWatchedFiles(): Promise<boolean> {
  const watchKey = currentWatchKey();
  if (watchKey === appliedWatchKey && !watcherUpdateInFlight) {
    return Promise.resolve(true);
  }
  if (watcherUpdateInFlight) {
    return watcherUpdateInFlight.then(() => applyWatchedFiles());
  }
  watcherUpdateInFlight = applyLatestWatchedFiles()
    .finally(() => {
      watcherUpdateInFlight = null;
    });
  return watcherUpdateInFlight;
}

async function applyLatestWatchedFiles(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const paths = watchedPathUnion();
  const watchKey = paths.map(normalizeWatchPath).sort().join('\n');
  if (watchKey === appliedWatchKey) return true;
  try {
    if (paths.length === 0) {
      await invoke('unwatch_files_for_changes');
    } else {
      await invoke('watch_files_for_changes', { paths });
    }
    appliedWatchKey = watchKey;
    return true;
  } catch (error) {
    appliedWatchKey = '';
    console.warn('File watcher unavailable; falling back to metadata polling.', error);
    return false;
  }
}

function currentWatchKey(): string {
  return watchedPathUnion().map(normalizeWatchPath).sort().join('\n');
}

function watchedPathUnion(): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const scopePaths of watchedScopes.values()) {
    for (const path of scopePaths) {
      if (!seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
  }
  return paths;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const rawPath of paths) {
    const path = rawPath.trim();
    const key = normalizeWatchPath(path);
    if (!path || seen.has(key)) continue;
    seen.add(key);
    unique.push(path);
  }
  return unique;
}

function normalizeWatchPath(path: string): string {
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
