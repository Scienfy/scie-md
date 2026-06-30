import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METADATA, type FileMetadata } from '../documentState';
import type { DocumentHost } from '../host/documentHost';
import { useExternalChangeDetection } from './useExternalChangeDetection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ExternalChangeCheck = ReturnType<typeof useExternalChangeDetection>;
type TestHost = Pick<DocumentHost, 'file' | 'watcher'>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
const documentPath = 'C:\\Lab\\paper.md';
const metadata: FileMetadata = {
  ...DEFAULT_METADATA,
  lastKnownMtimeMs: 1000,
  lastKnownSizeBytes: 8,
};

describe('useExternalChangeDetection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let host: TestHost;
  let latestCheck: ExternalChangeCheck | null;
  let onConflict: ReturnType<typeof vi.fn<() => void>>;
  let onSyncedExternalChange: ReturnType<typeof vi.fn<(path: string, content: string, metadata: FileMetadata) => void>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    host = createFakeHost();
    latestCheck = null;
    onConflict = vi.fn<() => void>();
    onSyncedExternalChange = vi.fn<(path: string, content: string, metadata: FileMetadata) => void>();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    delete runtimeWindow.__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it('does not start fallback polling when native document watching is active', async () => {
    vi.useFakeTimers();
    vi.mocked(host.watcher.updateWatchedFiles).mockResolvedValue(true);
    vi.mocked(host.file.statFile).mockResolvedValue(metadata);
    renderHarness();

    await act(async () => {
      await Promise.resolve();
    });
    const callsAfterNativeActivation = vi.mocked(host.file.statFile).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(host.watcher.updateWatchedFiles).toHaveBeenCalledWith(expect.stringMatching(/^document:/), [documentPath]);
    expect(vi.mocked(host.file.statFile).mock.calls.length).toBe(callsAfterNativeActivation);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('uses metadata polling as a fallback when native document watching is inactive', async () => {
    vi.useFakeTimers();
    vi.mocked(host.watcher.updateWatchedFiles).mockResolvedValue(false);
    vi.mocked(host.file.statFile).mockResolvedValue(metadata);
    renderHarness();

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(host.file.statFile).toHaveBeenCalledWith(documentPath, { contentHash: false });
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('retries native document watching after fallback polling starts', async () => {
    vi.useFakeTimers();
    vi.mocked(host.watcher.updateWatchedFiles)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.mocked(host.file.statFile).mockResolvedValue(metadata);
    renderHarness();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.watcher.updateWatchedFiles).toHaveBeenCalledTimes(1);
    expect(host.file.statFile).toHaveBeenCalledWith(documentPath, { contentHash: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(host.watcher.updateWatchedFiles).toHaveBeenCalledTimes(2);
    const callsAfterRecovery = vi.mocked(host.file.statFile).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(vi.mocked(host.file.statFile).mock.calls.length).toBe(callsAfterRecovery);
  });

  it('coalesces overlapping checks into one queued rerun', async () => {
    const firstStat = deferred<FileMetadata>();
    vi.mocked(host.file.statFile)
      .mockReturnValueOnce(firstStat.promise)
      .mockResolvedValue(metadata);
    renderHarness();

    const firstCheck = latestCheck?.();
    await Promise.resolve();
    const secondCheck = latestCheck?.();
    await Promise.resolve();

    expect(host.file.statFile).toHaveBeenCalledTimes(1);

    firstStat.resolve(metadata);
    await firstCheck;
    await secondCheck;

    expect(host.file.statFile).toHaveBeenCalledTimes(2);
    expect(onConflict).not.toHaveBeenCalled();
  });

  it('adopts changed disk metadata without conflict when disk content matches the current output', async () => {
    const changedMetadata = {
      ...metadata,
      lastKnownMtimeMs: 2000,
      contentHash: 'same-content-new-metadata',
    };
    vi.mocked(host.file.statFile).mockResolvedValue(changedMetadata);
    vi.mocked(host.file.readTextFile).mockResolvedValue({
      content: '# Paper\n',
      metadata: changedMetadata,
    });
    renderHarness();

    await act(async () => {
      await latestCheck?.();
    });

    expect(host.file.readTextFile).toHaveBeenCalledWith(documentPath);
    expect(onConflict).not.toHaveBeenCalled();
    expect(onSyncedExternalChange).toHaveBeenCalledWith(documentPath, '# Paper\n', changedMetadata);
  });

  function renderHarness() {
    act(() => {
      root.render(
        <Harness
          host={host}
          onConflict={onConflict}
          onSyncedExternalChange={onSyncedExternalChange}
          onCheck={(check) => {
            latestCheck = check;
          }}
        />,
      );
    });
  }
});

function Harness({
  host,
  onConflict,
  onSyncedExternalChange,
  onCheck,
}: {
  host: TestHost;
  onConflict: () => void;
  onSyncedExternalChange: (path: string, content: string, metadata: FileMetadata) => void;
  onCheck: (check: ExternalChangeCheck) => void;
}) {
  const check = useExternalChangeDetection({
    filePath: documentPath,
    fileMetadata: metadata,
    getCurrentMarkdown: () => '# Paper\n',
    onConflict,
    onSyncedExternalChange,
    host,
  });
  onCheck(check);
  return null;
}

function createFakeHost(): TestHost {
  return {
    file: {
      readTextFile: vi.fn(async () => ({ content: '# Paper\n', metadata })),
      readTextFileForEdit: vi.fn(),
      statFile: vi.fn(),
      writeTextFileAtomic: vi.fn(),
      createBackupSnapshot: vi.fn(),
    },
    watcher: {
      listenFileWatchChanges: vi.fn(async () => vi.fn<() => void>()),
      updateWatchedFiles: vi.fn(async () => true),
      clearWatchedFiles: vi.fn(async () => true),
    },
  };
}

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
