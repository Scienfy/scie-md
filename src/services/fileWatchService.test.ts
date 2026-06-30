import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { appendDiagnosticsEvent } from './nativeRecoveryService';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

vi.mock('./nativeRecoveryService', () => ({
  appendDiagnosticsEvent: vi.fn(async () => true),
}));

const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
const invokeMock = vi.mocked(invoke);
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

async function loadService() {
  vi.resetModules();
  return import('./fileWatchService');
}

afterEach(() => {
  delete runtimeWindow.__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe('fileWatchService', () => {
  it('coalesces rapid watcher updates to the latest desired path union', async () => {
    runtimeWindow.__TAURI_INTERNALS__ = {};
    const { updateWatchedFiles } = await loadService();
    const firstNativeUpdate = deferred<void>();
    invokeMock
      .mockReturnValueOnce(firstNativeUpdate.promise)
      .mockResolvedValueOnce(undefined);

    const firstResult = updateWatchedFiles('document', ['C:\\Lab\\paper-a.md']);
    const secondResult = updateWatchedFiles('document', ['C:\\Lab\\paper-b.md']);
    const thirdResult = updateWatchedFiles('document', ['C:\\Lab\\paper-c.md']);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'watch_files_for_changes', {
      paths: ['C:\\Lab\\paper-a.md'],
    });

    firstNativeUpdate.resolve(undefined);
    await expect(Promise.all([firstResult, secondResult, thirdResult])).resolves.toEqual([true, true, true]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'watch_files_for_changes', {
      paths: ['C:\\Lab\\paper-c.md'],
    });
  });

  it('shares one failed latest watcher update result with queued callers without retrying stale promises', async () => {
    runtimeWindow.__TAURI_INTERNALS__ = {};
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getFileWatchStatus, updateWatchedFiles } = await loadService();
    const firstNativeUpdate = deferred<void>();
    invokeMock
      .mockReturnValueOnce(firstNativeUpdate.promise)
      .mockRejectedValueOnce(new Error('watch failed'));

    const firstResult = updateWatchedFiles('document', ['C:\\Lab\\paper-a.md']);
    const secondResult = updateWatchedFiles('document', ['C:\\Lab\\paper-b.md']);
    const thirdResult = updateWatchedFiles('document', ['C:\\Lab\\paper-c.md']);

    firstNativeUpdate.resolve(undefined);
    await expect(Promise.all([firstResult, secondResult, thirdResult])).resolves.toEqual([false, false, false]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'watch_files_for_changes', {
      paths: ['C:\\Lab\\paper-c.md'],
    });
    expect(getFileWatchStatus()).toMatchObject({
      mode: 'polling',
      reason: 'registration-failed',
      paths: ['C:\\Lab\\paper-c.md'],
      message: 'watch failed',
    });
    expect(appendDiagnosticsEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'file-watch-registration-failed',
      message: 'watch failed',
      documentPath: 'C:\\Lab\\paper-c.md',
    }));
    warn.mockRestore();
  });

  it('coalesces a pending scope clear into one native unwatch call', async () => {
    runtimeWindow.__TAURI_INTERNALS__ = {};
    const { clearWatchedFiles, getFileWatchStatus, updateWatchedFiles } = await loadService();
    const firstNativeUpdate = deferred<void>();
    invokeMock
      .mockReturnValueOnce(firstNativeUpdate.promise)
      .mockResolvedValueOnce(undefined);

    const watchResult = updateWatchedFiles('document', ['C:\\Lab\\paper.md']);
    const clearResult = clearWatchedFiles('document');

    firstNativeUpdate.resolve(undefined);
    await expect(Promise.all([watchResult, clearResult])).resolves.toEqual([true, true]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'unwatch_files_for_changes');
    expect(getFileWatchStatus()).toMatchObject({ mode: 'inactive', reason: 'no-paths', paths: [] });
  });

  it('keeps the last applied watch key after a failed replacement', async () => {
    runtimeWindow.__TAURI_INTERNALS__ = {};
    const { getFileWatchStatus, updateWatchedFiles } = await loadService();
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(updateWatchedFiles('document', ['C:\\Lab\\paper.md'])).resolves.toBe(true);
    expect(getFileWatchStatus()).toMatchObject({ mode: 'active', reason: 'registered' });

    invokeMock.mockRejectedValueOnce(new Error('watch failed'));
    await expect(updateWatchedFiles('document', ['C:\\Lab\\missing.md'])).resolves.toBe(false);
    expect(getFileWatchStatus()).toMatchObject({ mode: 'polling', reason: 'registration-failed' });

    await expect(updateWatchedFiles('document', ['C:\\Lab\\paper.md'])).resolves.toBe(true);
    expect(getFileWatchStatus()).toMatchObject({ mode: 'active', reason: 'registration-recovered' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'watch_files_for_changes', {
      paths: ['C:\\Lab\\paper.md'],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'watch_files_for_changes', {
      paths: ['C:\\Lab\\missing.md'],
    });
  });

  it('records watcher recovery after a failed registration later succeeds', async () => {
    runtimeWindow.__TAURI_INTERNALS__ = {};
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getFileWatchStatus, updateWatchedFiles } = await loadService();
    invokeMock
      .mockRejectedValueOnce(new Error('watch failed'))
      .mockResolvedValueOnce(undefined);

    await expect(updateWatchedFiles('document', ['C:\\Lab\\paper-a.md'])).resolves.toBe(false);
    await expect(updateWatchedFiles('document', ['C:\\Lab\\paper-b.md'])).resolves.toBe(true);

    expect(getFileWatchStatus()).toMatchObject({
      mode: 'active',
      reason: 'registration-recovered',
      paths: ['C:\\Lab\\paper-b.md'],
      message: null,
    });
    warn.mockRestore();
  });

  it('reports unsupported native watching outside the desktop runtime', async () => {
    const { getFileWatchStatus, updateWatchedFiles } = await loadService();

    await expect(updateWatchedFiles('document', ['C:\\Lab\\paper.md'])).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(getFileWatchStatus()).toMatchObject({
      mode: 'unsupported',
      reason: 'non-tauri-runtime',
      paths: ['C:\\Lab\\paper.md'],
    });
  });

  it('caps watcher retry delay after repeated failures', async () => {
    const { fileWatchRetryDelayMs } = await loadService();

    expect(fileWatchRetryDelayMs(1)).toBe(2_000);
    expect(fileWatchRetryDelayMs(2)).toBe(10_000);
    expect(fileWatchRetryDelayMs(3)).toBe(30_000);
    expect(fileWatchRetryDelayMs(10)).toBe(30_000);
  });
});

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] | undefined;
  let reject: Deferred<T>['reject'] | undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}
