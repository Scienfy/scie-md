import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  formatBrowserTextIngressBudgetBytes,
  formatClipboardIngressBudgetBytes,
} from '@sciemd/core';
import { useDocumentDropPaste, type PasteReviewState, PASTE_REVIEW_THRESHOLD_CHARS, type TabularPasteState } from './useDocumentDropPaste';
import type { AuthorshipMark } from '../../markdown/authorship';
import type { DesktopPlatformHost } from '../host/platformHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockedCallback<T extends (...args: any[]) => unknown> = T & ReturnType<typeof vi.fn>;
type ValidateNow = (markdown: string, sizeBytes?: number) => unknown;
type SetAuthorshipMarks = Dispatch<SetStateAction<AuthorshipMark[]>>;
type SetPasteReview = Dispatch<SetStateAction<PasteReviewState | null>>;
type SetTabularPaste = Dispatch<SetStateAction<TabularPasteState | null>>;
type PushToast = (text: string, tone?: 'error' | 'warning' | 'info' | 'success') => void;
type CommitOpenedDocument = Parameters<typeof useDocumentDropPaste>[0]['commitOpenedDocument'];

describe('useDocumentDropPaste', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestHandlers: ReturnType<typeof useDocumentDropPaste> | null;
  let sourceTextRef: MutableRefObject<string>;
  let documentEpochRef: MutableRefObject<number>;
  let setPasteReview: MockedCallback<SetPasteReview>;
  let setTabularPaste: MockedCallback<SetTabularPaste>;
  let setAuthorshipMarks: MockedCallback<SetAuthorshipMarks>;
  let commitOpenedDocument: MockedCallback<CommitOpenedDocument>;
  let validateNow: MockedCallback<ValidateNow>;
  let pushToast: MockedCallback<PushToast>;
  let platformHost: DesktopPlatformHost;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestHandlers = null;
    sourceTextRef = { current: 'Before paste.\n' };
    documentEpochRef = { current: 1 };
    setPasteReview = vi.fn() as MockedCallback<SetPasteReview>;
    setTabularPaste = vi.fn() as MockedCallback<SetTabularPaste>;
    setAuthorshipMarks = vi.fn() as MockedCallback<SetAuthorshipMarks>;
    commitOpenedDocument = vi.fn() as MockedCallback<CommitOpenedDocument>;
    validateNow = vi.fn() as MockedCallback<ValidateNow>;
    pushToast = vi.fn() as MockedCallback<PushToast>;
    platformHost = createFakePlatformHost();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('drops delayed paste reviews when the document epoch changes before diffing', () => {
    vi.useFakeTimers();
    renderHookHarness();

    act(() => {
      latestHandlers?.handlePasteCapture(fakePasteEvent('x'.repeat(PASTE_REVIEW_THRESHOLD_CHARS + 1)));
    });

    documentEpochRef.current += 1;
    sourceTextRef.current = 'Different document content.\n';

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(validateNow).not.toHaveBeenCalled();
    expect(setPasteReview).not.toHaveBeenCalled();
    expect(setTabularPaste).not.toHaveBeenCalled();
    expect(setAuthorshipMarks).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('creates paste review state for large text changes that stay in the same document epoch', () => {
    vi.useFakeTimers();
    renderHookHarness();

    act(() => {
      latestHandlers?.handlePasteCapture(fakePasteEvent('x'.repeat(PASTE_REVIEW_THRESHOLD_CHARS + 1)));
    });
    sourceTextRef.current = 'Before paste.\n\nAfter paste.\n';

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(validateNow).toHaveBeenCalledWith('Before paste.\n\nAfter paste.\n');
    expect(setPasteReview).toHaveBeenCalledTimes(1);
    const review = setPasteReview.mock.calls[0][0] as PasteReviewState;
    expect(review.before).toBe('Before paste.\n');
    expect(review.after).toBe('Before paste.\n\nAfter paste.\n');
    expect(review.hunks.length).toBeGreaterThan(0);
    expect(pushToast).toHaveBeenCalledWith('Large paste detected. Review changes is available.', 'info');
  });

  it('intercepts likely CSV or TSV paste and opens a conversion preview before insertion', () => {
    renderHookHarness();
    const event = fakePasteEvent('sample\tcount\nA\t1\nB\t2\n');

    act(() => {
      latestHandlers?.handlePasteCapture(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(setTabularPaste).toHaveBeenCalledTimes(1);
    const tabularPaste = setTabularPaste.mock.calls[0][0] as TabularPasteState;
    expect(tabularPaste.preview.parsed.delimiter).toBe('\t');
    expect(tabularPaste.preview.markdown.content).toContain('| sample | count |');
    expect(setPasteReview).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Delimited data detected. Choose an output format before inserting.',
      'info',
    );
  });

  it('skips structured paste detection and diff review for oversized clipboard text', () => {
    renderHookHarness();
    const event = fakePasteEvent('x'.repeat(formatClipboardIngressBudgetBytes(null) + 1));

    act(() => {
      latestHandlers?.handlePasteCapture(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setTabularPaste).not.toHaveBeenCalled();
    expect(setPasteReview).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Large clipboard text'), 'warning');
  });

  it('opens dropped structured document paths through the normal document opener', async () => {
    let droppedPathsListener: ((paths: string[]) => void) | null = null;
    vi.mocked(platformHost.dragDrop.listenDroppedPaths).mockImplementation(async (listener) => {
      droppedPathsListener = listener;
      const dispose = vi.fn<() => void>();
      return dispose;
    });
    const openDocumentPath = vi.fn(async () => undefined);
    renderHookHarness({ openDocumentPath });

    await act(async () => {
      droppedPathsListener?.(['C:\\lab\\data.json']);
      await Promise.resolve();
    });

    expect(openDocumentPath).toHaveBeenCalledWith('C:\\lab\\data.json');
  });

  it('opens dropped structured browser files with an inferred visual-mode format', async () => {
    renderHookHarness();
    const file = new File(['{"id":1}\n'], 'data.json', { type: 'application/json' });
    const event = fakeDropEvent([file]);

    await act(async () => {
      latestHandlers?.handleDropCapture(event);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(commitOpenedDocument).toHaveBeenCalledWith(
      null,
      '{"id":1}\n',
      expect.objectContaining({ encoding: 'utf8' }),
      'visual',
      '{"id":1}\n',
      'json',
    );
  });

  it('strips a leading BOM before opening dropped structured browser files', async () => {
    renderHookHarness();
    const file = new File(['\ufeff{"id":1}\n'], 'data.json', { type: 'application/json' });
    const event = fakeDropEvent([file]);

    await act(async () => {
      latestHandlers?.handleDropCapture(event);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(commitOpenedDocument).toHaveBeenCalledWith(
      null,
      '{"id":1}\n',
      expect.objectContaining({ encoding: 'utf8' }),
      'visual',
      '{"id":1}\n',
      'json',
    );
  });

  it('rejects oversized browser-dropped document files before reading their text', () => {
    renderHookHarness();
    const size = formatBrowserTextIngressBudgetBytes('json') + 1;
    const file = new File([new Uint8Array(size)], 'large.json', { type: 'application/json' });
    const event = fakeDropEvent([file]);

    act(() => {
      latestHandlers?.handleDropCapture(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(commitOpenedDocument).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('too large for browser drag-and-drop import'), 'warning');
  });

  it('does not intercept normal prose paste as tabular data', () => {
    renderHookHarness();
    const event = fakePasteEvent('This is a paragraph.\nThis is another sentence.');

    act(() => {
      latestHandlers?.handlePasteCapture(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setTabularPaste).not.toHaveBeenCalled();
  });

  it('disposes a host drag-drop listener if registration resolves after unmount', async () => {
    const dispose = vi.fn();
    let resolveRegistration: ((dispose: () => void) => void) | null = null;
    vi.mocked(platformHost.dragDrop.listenDroppedPaths).mockReturnValue(new Promise((resolve) => {
      resolveRegistration = resolve;
    }));

    renderHookHarness();

    act(() => {
      root.unmount();
    });

    await act(async () => {
      resolveRegistration?.(dispose);
      await Promise.resolve();
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  function renderHookHarness(overrides: Partial<Pick<Parameters<typeof useDocumentDropPaste>[0], 'openDocumentPath'>> = {}) {
    act(() => {
      root.render(
        <Harness
          sourceTextRef={sourceTextRef}
          documentEpochRef={documentEpochRef}
          setAuthorshipMarks={setAuthorshipMarks}
          setPasteReview={setPasteReview}
          setTabularPaste={setTabularPaste}
          validateNow={validateNow}
          pushToast={pushToast}
          platformHost={platformHost}
          commitOpenedDocument={commitOpenedDocument}
          openDocumentPath={overrides.openDocumentPath}
          onHandlers={(handlers) => {
            latestHandlers = handlers;
          }}
        />,
      );
    });
  }
});

function Harness({
  sourceTextRef,
  documentEpochRef,
  setAuthorshipMarks,
  setPasteReview,
  setTabularPaste,
  validateNow,
  pushToast,
  platformHost,
  commitOpenedDocument,
  openDocumentPath,
  onHandlers,
}: {
  sourceTextRef: MutableRefObject<string>;
  documentEpochRef: MutableRefObject<number>;
  setAuthorshipMarks: SetAuthorshipMarks;
  setPasteReview: SetPasteReview;
  setTabularPaste: SetTabularPaste;
  validateNow: ValidateNow;
  pushToast: PushToast;
  platformHost: DesktopPlatformHost;
  commitOpenedDocument: CommitOpenedDocument;
  openDocumentPath?: (path: string) => Promise<void>;
  onHandlers: (handlers: ReturnType<typeof useDocumentDropPaste>) => void;
}) {
  const handlers = useDocumentDropPaste({
    sourceTextRef,
    documentEpochRef,
    insertImageBlob: vi.fn(),
    insertImageFromPath: vi.fn(),
    openDocumentPath: openDocumentPath ?? vi.fn(),
    settleDirtyDocumentBeforeReplace: vi.fn().mockResolvedValue(true),
    commitOpenedDocument,
    validateNow,
    setAuthorshipMarks,
    setPasteReview,
    setTabularPaste,
    pushToast,
    platformHost,
  });
  onHandlers(handlers);
  return null;
}

function fakePasteEvent(text: string) {
  return {
    clipboardData: {
      items: [],
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
    preventDefault: vi.fn(),
  } as unknown as ReturnType<typeof useDocumentDropPaste> extends { handlePasteCapture: (event: infer E) => void } ? E : never;
}

function fakeDropEvent(files: File[]) {
  return {
    dataTransfer: {
      files,
    },
    preventDefault: vi.fn(),
  } as unknown as ReturnType<typeof useDocumentDropPaste> extends { handleDropCapture: (event: infer E) => void } ? E : never;
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
