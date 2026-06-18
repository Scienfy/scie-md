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
let watcherUpdateQueue: Promise<boolean> = Promise.resolve(true);

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
  const paths = watchedPathUnion();
  watcherUpdateQueue = watcherUpdateQueue
    .catch(() => false)
    .then(async () => {
      if (!isTauriRuntime()) return false;
      try {
        if (paths.length === 0) {
          await invoke('unwatch_files_for_changes');
        } else {
          await invoke('watch_files_for_changes', { paths });
        }
        return true;
      } catch (error) {
        console.warn('File watcher unavailable; falling back to metadata polling.', error);
        return false;
      }
    });
  return watcherUpdateQueue;
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
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}
