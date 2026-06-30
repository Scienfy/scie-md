import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageInsertion } from './useImageInsertion';
import type { DesktopPlatformHost } from '../host/platformHost';
import type { PromptState } from './useDialogs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ImageInsertionState = ReturnType<typeof useImageInsertion>;
type PromptText = (state: PromptState) => Promise<string | null>;
type PushToast = (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;

describe('useImageInsertion', () => {
  let container: HTMLDivElement;
  let root: Root;
  let platformHost: DesktopPlatformHost;
  let latestState: ImageInsertionState | null;
  let sourceInsert: ReturnType<typeof vi.fn<(snippet: string) => void>>;
  let ensureDocumentPathForAssets: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
  let promptText: ReturnType<typeof vi.fn<PromptText>>;
  let pushToast: ReturnType<typeof vi.fn<PushToast>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    platformHost = createFakePlatformHost();
    latestState = null;
    sourceInsert = vi.fn<(snippet: string) => void>();
    ensureDocumentPathForAssets = vi.fn(async () => 'C:\\docs\\paper.md');
    promptText = vi.fn<PromptText>(async () => 'Annotated figure');
    pushToast = vi.fn<PushToast>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('copies a path-picked image through the platform host before inserting Markdown', async () => {
    vi.mocked(platformHost.assets.pickImageFile).mockResolvedValue('C:\\incoming\\figure.png');
    vi.mocked(platformHost.assets.grantExternalImagePath).mockResolvedValue('C:\\incoming\\figure.png');
    vi.mocked(platformHost.assets.copyImageToAssets).mockResolvedValue({
      markdownPath: 'assets/figure.png',
      fileName: 'figure.png',
      altText: 'Annotated figure',
    });
    vi.mocked(platformHost.assets.defaultImageAlt).mockReturnValue('figure');
    vi.mocked(platformHost.assets.markdownImageSyntax).mockReturnValue('![Annotated figure](assets/figure.png)');
    renderHarness();

    await act(async () => {
      await latestState?.handleInsertImage();
    });

    expect(platformHost.assets.pickImageFile).toHaveBeenCalled();
    expect(promptText).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: 'figure' }));
    expect(platformHost.assets.grantExternalImagePath).toHaveBeenCalledWith('C:\\incoming\\figure.png');
    expect(platformHost.assets.copyImageToAssets).toHaveBeenCalledWith('C:\\docs\\paper.md', 'C:\\incoming\\figure.png', 'Annotated figure');
    expect(sourceInsert).toHaveBeenCalledWith('![Annotated figure](assets/figure.png)\n');
    expect(pushToast).toHaveBeenCalledWith('Image inserted', 'success');
  });

  it('saves pasted image bytes through the platform host before inserting Markdown', async () => {
    vi.mocked(platformHost.assets.imageFileNameFromBlob).mockReturnValue('paste.png');
    vi.mocked(platformHost.assets.defaultImageAlt).mockReturnValue('paste');
    vi.mocked(platformHost.assets.blobToByteArray).mockResolvedValue([1, 2, 3]);
    vi.mocked(platformHost.assets.saveImageBytesToAssets).mockResolvedValue({
      markdownPath: 'assets/paste.png',
      fileName: 'paste.png',
      altText: 'paste',
    });
    vi.mocked(platformHost.assets.markdownImageSyntax).mockReturnValue('![paste](assets/paste.png)');
    renderHarness();

    await act(async () => {
      await latestState?.insertImageBlob(new Blob(['image'], { type: 'image/png' }), 'paste');
    });

    expect(platformHost.assets.imageFileNameFromBlob).toHaveBeenCalled();
    expect(platformHost.assets.blobToByteArray).toHaveBeenCalled();
    expect(platformHost.assets.saveImageBytesToAssets).toHaveBeenCalledWith('C:\\docs\\paper.md', 'paste.png', [1, 2, 3], 'paste');
    expect(sourceInsert).toHaveBeenCalledWith('![paste](assets/paste.png)\n');
    expect(pushToast).toHaveBeenCalledWith('Image pasted', 'success');
  });

  function renderHarness() {
    act(() => {
      root.render(
        <Harness
          platformHost={platformHost}
          sourceInsert={sourceInsert}
          ensureDocumentPathForAssets={ensureDocumentPathForAssets}
          promptText={promptText}
          pushToast={pushToast}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }
});

function Harness({
  platformHost,
  sourceInsert,
  ensureDocumentPathForAssets,
  promptText,
  pushToast,
  onState,
}: {
  platformHost: DesktopPlatformHost;
  sourceInsert: (snippet: string) => void;
  ensureDocumentPathForAssets: () => Promise<string | null>;
  promptText: PromptText;
  pushToast: PushToast;
  onState: (state: ImageInsertionState) => void;
}) {
  const state = useImageInsertion({
    mode: 'source',
    sourceInsertHandler: sourceInsert,
    visualInsertHandler: undefined,
    ensureDocumentPathForAssets,
    promptText,
    pushToast,
    platformHost,
  });
  onState(state);
  return null;
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
      isImagePath: vi.fn((path: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path)),
      imageFileNameFromBlob: vi.fn((_blob: Blob, preferredName?: string) => preferredName ?? 'image.png'),
      blobToByteArray: vi.fn(async () => []),
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
