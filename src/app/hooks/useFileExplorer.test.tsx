import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileExplorerEntry } from '../../services/fileService';
import { listReadableFiles, pickFolder } from '../../services/fileService';
import { useFileExplorer } from './useFileExplorer';

vi.mock('../../services/fileService', () => ({
  listReadableFiles: vi.fn(),
  pickFolder: vi.fn(),
}));

vi.mock('../../services/fileWatchService', () => ({
  clearWatchedFiles: vi.fn().mockResolvedValue(undefined),
  listenFileWatchChanges: vi.fn().mockResolvedValue(vi.fn()),
  updateWatchedFiles: vi.fn().mockResolvedValue(undefined),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ExplorerState = ReturnType<typeof useFileExplorer>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const entries: FileExplorerEntry[] = [
  {
    name: 'paper.md',
    path: 'C:\\Users\\amin_\\Downloads\\paper.md',
    kind: 'markdown',
    sizeBytes: 12,
    modifiedMs: 1,
  },
];

describe('useFileExplorer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: ExplorerState | null;
  let persistPath: ReturnType<typeof vi.fn<(path: string) => void>>;
  let openDocument: ReturnType<typeof vi.fn<(path: string) => void>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    persistPath = vi.fn<(path: string) => void>();
    openDocument = vi.fn<(path: string) => void>();
    vi.mocked(listReadableFiles).mockReset();
    vi.mocked(pickFolder).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('clears a visible loading state even when a silent refresh supersedes the request', async () => {
    const visibleLoad = deferred<FileExplorerEntry[]>();
    vi.mocked(listReadableFiles)
      .mockReturnValueOnce(visibleLoad.promise)
      .mockResolvedValueOnce(entries);
    renderExplorer();

    let visiblePromise: Promise<void> | undefined;
    act(() => {
      visiblePromise = latestState?.loadDirectory('C:\\Users\\amin_\\Downloads');
    });
    expect(latestState?.loading).toBe(true);

    await act(async () => {
      await latestState?.loadDirectory('C:\\Users\\amin_\\Downloads', { silent: true });
    });
    expect(latestState?.loading).toBe(true);

    visibleLoad.resolve(entries);
    await act(async () => {
      await visiblePromise;
    });

    expect(latestState?.loading).toBe(false);
    expect(latestState?.error).toBeNull();
  });

  it('turns an indefinitely pending visible folder load into a recoverable error', async () => {
    vi.useFakeTimers();
    vi.mocked(listReadableFiles).mockReturnValue(new Promise(() => undefined));
    renderExplorer();

    let loadPromise: Promise<void> | undefined;
    act(() => {
      loadPromise = latestState?.loadDirectory('C:\\Users\\amin_\\Downloads');
    });
    expect(latestState?.loading).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await loadPromise;
    });

    expect(latestState?.loading).toBe(false);
    expect(latestState?.error).toContain('Folder loading took too long');
  });

  it('keeps background folder sync out of the visible loading state', async () => {
    vi.mocked(listReadableFiles).mockResolvedValue(entries);
    renderExplorer();

    await act(async () => {
      await latestState?.loadDirectory('C:\\Users\\amin_\\Downloads', { silent: true });
    });

    expect(latestState?.loading).toBe(false);
    expect(latestState?.currentPath).toBe('C:\\Users\\amin_\\Downloads');
    expect(latestState?.entries).toEqual(entries);
  });

  it('suppresses stale remembered folder errors during initial background load', async () => {
    vi.mocked(listReadableFiles).mockRejectedValue(new Error('File access denied'));
    renderExplorer('C:\\Users\\amin_\\Downloads');

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestState?.loading).toBe(false);
    expect(latestState?.error).toBeNull();
    expect(latestState?.currentPath).toBeNull();
  });

  function renderExplorer(initialPath: string | null = null) {
    act(() => {
      root.render(
        <Harness
          initialPath={initialPath}
          onPersistPath={persistPath}
          onOpenDocument={openDocument}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }
});

function Harness({
  initialPath,
  onPersistPath,
  onOpenDocument,
  onState,
}: {
  initialPath: string | null;
  onPersistPath: (path: string) => void;
  onOpenDocument: (path: string) => void;
  onState: (state: ExplorerState) => void;
}) {
  const state = useFileExplorer({ initialPath, onPersistPath, onOpenDocument });
  onState(state);
  return null;
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
