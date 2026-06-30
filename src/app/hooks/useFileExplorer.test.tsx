import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileExplorerEntry } from '../../services/fileService';
import { useFileExplorer } from './useFileExplorer';
import type { DesktopPlatformHost } from '../host/platformHost';

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
  let platformHost: DesktopPlatformHost;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    persistPath = vi.fn<(path: string) => void>();
    openDocument = vi.fn<(path: string) => void>();
    platformHost = createFakePlatformHost();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('clears a visible loading state even when a silent refresh supersedes the request', async () => {
    const visibleLoad = deferred<FileExplorerEntry[]>();
    vi.mocked(platformHost.fileBrowser.listReadableFiles)
      .mockReturnValueOnce(visibleLoad.promise)
      .mockResolvedValueOnce(entries);
    renderExplorer();

    let visiblePromise: Promise<boolean> | undefined;
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
    vi.mocked(platformHost.fileBrowser.listReadableFiles).mockReturnValue(new Promise(() => undefined));
    renderExplorer();

    let loadPromise: Promise<boolean> | undefined;
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
    vi.mocked(platformHost.fileBrowser.listReadableFiles).mockResolvedValue(entries);
    renderExplorer();

    await act(async () => {
      await latestState?.loadDirectory('C:\\Users\\amin_\\Downloads', { silent: true });
    });

    expect(latestState?.loading).toBe(false);
    expect(latestState?.currentPath).toBe('C:\\Users\\amin_\\Downloads');
    expect(latestState?.entries).toEqual(entries);
  });

  it('suppresses stale remembered folder errors during initial background load', async () => {
    vi.mocked(platformHost.fileBrowser.listReadableFiles).mockRejectedValue(new Error('File access denied'));
    renderExplorer('C:\\Users\\amin_\\Downloads');

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestState?.loading).toBe(false);
    expect(latestState?.error).toBeNull();
    expect(latestState?.currentPath).toBeNull();
  });

  it('falls back to the remembered folder when the preferred startup folder cannot load', async () => {
    vi.mocked(platformHost.fileBrowser.listReadableFiles)
      .mockRejectedValueOnce(new Error('File access denied'))
      .mockResolvedValueOnce(entries);
    renderExplorer('C:\\Users\\amin_\\Research', 'C:\\Users\\amin_\\Downloads');

    await flushAsync();

    expect(platformHost.fileBrowser.listReadableFiles).toHaveBeenNthCalledWith(1, 'C:\\Users\\amin_\\Research');
    expect(platformHost.fileBrowser.listReadableFiles).toHaveBeenNthCalledWith(2, 'C:\\Users\\amin_\\Downloads');
    expect(latestState?.error).toBeNull();
    expect(latestState?.currentPath).toBe('C:\\Users\\amin_\\Downloads');
    expect(latestState?.entries).toEqual(entries);
  });

  it('shows a polling status when native folder watching is inactive', async () => {
    vi.useFakeTimers();
    vi.mocked(platformHost.fileBrowser.listReadableFiles).mockResolvedValue(entries);
    vi.mocked(platformHost.watcher.updateWatchedFiles).mockResolvedValue(false);
    renderExplorer();

    await act(async () => {
      await latestState?.loadDirectory('C:\\Users\\amin_\\Downloads');
      await Promise.resolve();
    });

    expect(platformHost.watcher.updateWatchedFiles).toHaveBeenCalledWith(expect.stringMatching(/^explorer:/), ['C:\\Users\\amin_\\Downloads']);
    expect(latestState?.watcherMessage).toContain('checked periodically');
    expect(latestState?.error).toBeNull();
  });

  it('clears the polling status after native folder watching recovers', async () => {
    vi.useFakeTimers();
    vi.mocked(platformHost.fileBrowser.listReadableFiles).mockResolvedValue(entries);
    vi.mocked(platformHost.watcher.updateWatchedFiles)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderExplorer();

    await act(async () => {
      await latestState?.loadDirectory('C:\\Users\\amin_\\Downloads');
      await Promise.resolve();
    });

    expect(latestState?.watcherMessage).toContain('checked periodically');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(platformHost.watcher.updateWatchedFiles).toHaveBeenCalledTimes(2);
    expect(latestState?.watcherMessage).toBeNull();
  });

  function renderExplorer(initialPath: string | null = null, fallbackInitialPath: string | null = null) {
    act(() => {
      root.render(
        <Harness
          initialPath={initialPath}
          fallbackInitialPath={fallbackInitialPath}
          onPersistPath={persistPath}
          onOpenDocument={openDocument}
          platformHost={platformHost}
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
  fallbackInitialPath,
  onPersistPath,
  onOpenDocument,
  platformHost,
  onState,
}: {
  initialPath: string | null;
  fallbackInitialPath?: string | null;
  onPersistPath: (path: string) => void;
  onOpenDocument: (path: string) => void;
  platformHost: DesktopPlatformHost;
  onState: (state: ExplorerState) => void;
}) {
  const state = useFileExplorer({ initialPath, fallbackInitialPath, onPersistPath, onOpenDocument, platformHost });
  onState(state);
  return null;
}

async function flushAsync() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }
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

function createFakePlatformHost(): DesktopPlatformHost {
  return {
    runtime: {
      isDesktopRuntime: vi.fn(() => true),
    },
    assets: {
      pickImageFile: vi.fn(),
      grantExternalImagePath: vi.fn(),
      copyImageToAssets: vi.fn(),
      saveImageBytesToAssets: vi.fn(),
      defaultImageAlt: vi.fn((path: string) => path),
      markdownImageSyntax: vi.fn((alt: string, path: string) => `![${alt}](${path})`),
      isImagePath: vi.fn(),
      imageFileNameFromBlob: vi.fn(),
      blobToByteArray: vi.fn(),
    },
    export: {
      pickHtmlSavePath: vi.fn(),
      pickExportSavePath: vi.fn(),
      writeTextFileAtomic: vi.fn(),
      defaultPandocExportPath: vi.fn(),
      checkPandocAvailable: vi.fn(),
      exportStyledHtmlToPdf: vi.fn(),
      exportHtmlToDocxNative: vi.fn(),
      exportHtmlWithPandoc: vi.fn(),
      exportWithPandoc: vi.fn(),
    },
    inkscape: {
      checkAvailable: vi.fn(),
      exportSvg: vi.fn(),
    },
    fileBrowser: {
      pickFolder: vi.fn(),
      listReadableFiles: vi.fn(),
    },
    watcher: {
      listenFileWatchChanges: vi.fn(async () => vi.fn()),
      updateWatchedFiles: vi.fn(async () => true),
      clearWatchedFiles: vi.fn(async () => true),
    },
    dragDrop: {
      listenDroppedPaths: vi.fn(async () => vi.fn()),
    },
    reveal: {
      revealInFileManager: vi.fn(),
    },
    maintenance: {
      cleanupStaleTempFilesForPaths: vi.fn(),
    },
  };
}
