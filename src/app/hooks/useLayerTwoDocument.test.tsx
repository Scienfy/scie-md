import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METADATA, type FileMetadata } from '../documentState';
import type { DocumentHost, HostUnlisten } from '../host/documentHost';
import type { FileWatchChangeEvent } from '../../services/fileWatchService';
import { useLayerTwoDocument } from './useLayerTwoDocument';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestHost = Pick<DocumentHost, 'file' | 'watcher'>;
type WatchCallback = (event: FileWatchChangeEvent) => void;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
const documentPath = 'C:\\Lab\\paper.md';
const bibliographyPath = 'C:\\Lab\\refs.bib';
const metadata: FileMetadata = {
  ...DEFAULT_METADATA,
  lastKnownMtimeMs: 1000,
  lastKnownSizeBytes: 24,
};
const markdownWithBibliography = [
  '---',
  'bibliography: refs.bib',
  '---',
  '# Paper',
  '',
  'A cited claim [@smith2026].',
  '',
].join('\n');

describe('useLayerTwoDocument linked-file refresh', () => {
  let container: HTMLDivElement;
  let root: Root;
  let host: TestHost;
  let watchCallback: WatchCallback | null;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    watchCallback = null;
    host = createFakeHost((callback) => {
      watchCallback = callback;
    });
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

  it('does not poll bibliography files while native watching is active', async () => {
    vi.mocked(host.watcher.updateWatchedFiles).mockResolvedValue(true);
    renderHarness();

    await advance(250);
    expect(host.file.statFile).toHaveBeenCalledTimes(1);
    expect(host.file.readTextFile).toHaveBeenCalledTimes(1);

    await advance(10_000);

    expect(host.watcher.updateWatchedFiles).toHaveBeenCalledWith(expect.stringMatching(/^bibliography:/), [bibliographyPath]);
    expect(host.file.statFile).toHaveBeenCalledTimes(1);
    expect(host.file.readTextFile).toHaveBeenCalledTimes(1);
  });

  it('polls bibliography file metadata only after watcher activation fails', async () => {
    vi.mocked(host.watcher.updateWatchedFiles).mockResolvedValue(false);
    renderHarness();

    await advance(250);
    expect(host.file.statFile).toHaveBeenCalledTimes(1);
    expect(host.file.readTextFile).toHaveBeenCalledTimes(1);

    await advance(10_000);

    expect(host.file.statFile).toHaveBeenCalledTimes(2);
    expect(host.file.readTextFile).toHaveBeenCalledTimes(1);
  });

  it('queues a bibliography refresh instead of overlapping reads', async () => {
    const firstStat = deferred<FileMetadata>();
    vi.mocked(host.file.statFile)
      .mockReturnValueOnce(firstStat.promise)
      .mockResolvedValue(metadata);
    renderHarness();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(host.file.statFile).toHaveBeenCalledTimes(1);

    act(() => {
      watchCallback?.({
        paths: [bibliographyPath],
        kind: 'Modify(Data)',
        changedAtMs: Date.now(),
      });
    });
    expect(host.file.statFile).toHaveBeenCalledTimes(1);

    firstStat.resolve(metadata);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.file.statFile).toHaveBeenCalledTimes(2);
    expect(host.file.readTextFile).toHaveBeenCalledTimes(1);
  });

  function renderHarness() {
    act(() => {
      root.render(
        <Harness
          markdown={markdownWithBibliography}
          filePath={documentPath}
          host={host}
        />,
      );
    });
  }
});

function Harness({
  markdown,
  filePath,
  host,
}: {
  markdown: string;
  filePath: string;
  host: TestHost;
}) {
  useLayerTwoDocument(markdown, filePath, host);
  return null;
}

function createFakeHost(onListen: (callback: WatchCallback) => void): TestHost {
  return {
    file: {
      readTextFile: vi.fn(async () => ({
        content: '@article{smith2026, title={Result}, author={Smith}, year={2026}}',
        metadata,
      })),
      readTextFileForEdit: vi.fn(),
      statFile: vi.fn(async () => metadata),
      writeTextFileAtomic: vi.fn(),
      createBackupSnapshot: vi.fn(),
    },
    watcher: {
      listenFileWatchChanges: vi.fn(async (callback: WatchCallback): Promise<HostUnlisten> => {
        onListen(callback);
        return vi.fn<() => void>();
      }),
      updateWatchedFiles: vi.fn(async () => true),
      clearWatchedFiles: vi.fn(async () => true),
    },
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });
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
