import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { isTauriRuntime } from '../app/runtime';
import { appendDiagnosticsEvent } from './nativeRecoveryService';

export interface FileWatchChangeEvent {
  paths: string[];
  kind: string;
  changedAtMs: number;
}

export type FileWatchStatusMode = 'unsupported' | 'inactive' | 'active' | 'polling';
export type FileWatchStatusReason =
  | 'non-tauri-runtime'
  | 'no-paths'
  | 'registered'
  | 'registration-recovered'
  | 'registration-failed'
  | 'unwatch-failed';

export interface FileWatchStatus {
  mode: FileWatchStatusMode;
  reason: FileWatchStatusReason;
  paths: string[];
  message: string | null;
  updatedAtMs: number;
}

const WATCH_RETRY_DELAYS_MS = [2_000, 10_000, 30_000];
const watchedScopes = new Map<string, string[]>();
let appliedWatchKey = '';
let watcherUpdateInFlight: Promise<boolean> | null = null;
let watcherUpdateRequested = false;
let watcherStatus: FileWatchStatus = createWatchStatus('inactive', 'no-paths', [], null);

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
  const watchKey = watchKeyForPaths(paths);
  if (watchKey === appliedWatchKey && !watcherUpdateInFlight) {
    setWatchStatus(createWatchStatus(
      paths.length === 0 ? 'inactive' : 'active',
      paths.length === 0
        ? 'no-paths'
        : watcherStatus.mode === 'polling' ? 'registration-recovered' : 'registered',
      paths,
      null,
    ));
    return Promise.resolve(true);
  }
  watcherUpdateRequested = true;
  if (!watcherUpdateInFlight) {
    watcherUpdateInFlight = drainWatcherUpdates()
      .finally(() => {
        watcherUpdateInFlight = null;
      });
  }
  return watcherUpdateInFlight;
}

async function drainWatcherUpdates(): Promise<boolean> {
  let result = true;
  while (watcherUpdateRequested) {
    watcherUpdateRequested = false;
    result = await applyLatestWatchedFiles();
  }
  return result;
}

async function applyLatestWatchedFiles(): Promise<boolean> {
  if (!isTauriRuntime()) {
    setWatchStatus(createWatchStatus(
      'unsupported',
      'non-tauri-runtime',
      watchedPathUnion(),
      'Native file watching is unavailable outside the desktop runtime.',
    ));
    return false;
  }
  const paths = watchedPathUnion();
  const watchKey = watchKeyForPaths(paths);
  if (watchKey === appliedWatchKey) return true;
  try {
    if (paths.length === 0) {
      await invoke('unwatch_files_for_changes');
      setWatchStatus(createWatchStatus('inactive', 'no-paths', [], null));
    } else {
      await invoke('watch_files_for_changes', { paths });
      setWatchStatus(createWatchStatus(
        'active',
        watcherStatus.mode === 'polling' ? 'registration-recovered' : 'registered',
        paths,
        null,
      ));
    }
    appliedWatchKey = watchKey;
    return true;
  } catch (error) {
    console.warn('File watcher unavailable; falling back to metadata polling.', error);
    const message = errorMessage(error);
    void appendDiagnosticsEvent({
      eventType: paths.length === 0 ? 'file-watch-unwatch-failed' : 'file-watch-registration-failed',
      message,
      documentPath: paths[0] ?? null,
    });
    setWatchStatus(createWatchStatus(
      paths.length === 0 ? 'inactive' : 'polling',
      paths.length === 0 ? 'unwatch-failed' : 'registration-failed',
      paths,
      message,
    ));
    return false;
  }
}

export function getFileWatchStatus(): FileWatchStatus {
  return { ...watcherStatus, paths: watcherStatus.paths.slice() };
}

export function fileWatchRetryDelayMs(failureCount: number): number {
  if (failureCount <= 0) return WATCH_RETRY_DELAYS_MS[0];
  return WATCH_RETRY_DELAYS_MS[Math.min(failureCount - 1, WATCH_RETRY_DELAYS_MS.length - 1)];
}

function setWatchStatus(status: FileWatchStatus): void {
  watcherStatus = status;
}

function createWatchStatus(
  mode: FileWatchStatusMode,
  reason: FileWatchStatusReason,
  paths: string[],
  message: string | null,
): FileWatchStatus {
  return {
    mode,
    reason,
    paths: paths.slice(),
    message,
    updatedAtMs: Date.now(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function watchKeyForPaths(paths: string[]): string {
  return paths.map(normalizeWatchPath).sort().join('\n');
}

function watchedPathUnion(): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const scopePaths of watchedScopes.values()) {
    for (const path of scopePaths) {
      const key = normalizeWatchPath(path);
      if (!seen.has(key)) {
        seen.add(key);
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
