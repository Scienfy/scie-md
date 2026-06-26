import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { FileMetadata } from '../documentState';
import { useDocumentDropPaste, type PasteReviewState, PASTE_REVIEW_THRESHOLD_CHARS } from './useDocumentDropPaste';
import type { AuthorshipMark } from '../../markdown/authorship';

const tauriWindow = vi.hoisted(() => ({
  onDragDropEvent: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: tauriWindow.onDragDropEvent,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockedCallback<T extends (...args: any[]) => unknown> = T & ReturnType<typeof vi.fn>;
type ValidateNow = (markdown: string, sizeBytes?: number) => unknown;
type SetAuthorshipMarks = Dispatch<SetStateAction<AuthorshipMark[]>>;
type SetPasteReview = Dispatch<SetStateAction<PasteReviewState | null>>;
type PushToast = (text: string, tone?: 'error' | 'warning' | 'info' | 'success') => void;

describe('useDocumentDropPaste', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestHandlers: ReturnType<typeof useDocumentDropPaste> | null;
  let markdownRef: MutableRefObject<string>;
  let documentEpochRef: MutableRefObject<number>;
  let setPasteReview: MockedCallback<SetPasteReview>;
  let setAuthorshipMarks: MockedCallback<SetAuthorshipMarks>;
  let validateNow: MockedCallback<ValidateNow>;
  let pushToast: MockedCallback<PushToast>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestHandlers = null;
    markdownRef = { current: 'Before paste.\n' };
    documentEpochRef = { current: 1 };
    setPasteReview = vi.fn() as MockedCallback<SetPasteReview>;
    setAuthorshipMarks = vi.fn() as MockedCallback<SetAuthorshipMarks>;
    validateNow = vi.fn() as MockedCallback<ValidateNow>;
    pushToast = vi.fn() as MockedCallback<PushToast>;
    tauriWindow.onDragDropEvent.mockReset();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('drops delayed paste reviews when the document epoch changes before diffing', () => {
    vi.useFakeTimers();
    renderHookHarness();

    act(() => {
      latestHandlers?.handlePasteCapture(fakePasteEvent('x'.repeat(PASTE_REVIEW_THRESHOLD_CHARS + 1)));
    });

    documentEpochRef.current += 1;
    markdownRef.current = 'Different document content.\n';

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(validateNow).not.toHaveBeenCalled();
    expect(setPasteReview).not.toHaveBeenCalled();
    expect(setAuthorshipMarks).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('creates paste review state for large text changes that stay in the same document epoch', () => {
    vi.useFakeTimers();
    renderHookHarness();

    act(() => {
      latestHandlers?.handlePasteCapture(fakePasteEvent('x'.repeat(PASTE_REVIEW_THRESHOLD_CHARS + 1)));
    });
    markdownRef.current = 'Before paste.\n\nAfter paste.\n';

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

  it('disposes a Tauri drag-drop listener if registration resolves after unmount', async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const dispose = vi.fn();
    let resolveRegistration: ((dispose: () => void) => void) | null = null;
    tauriWindow.onDragDropEvent.mockReturnValue(new Promise((resolve) => {
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

  function renderHookHarness() {
    act(() => {
      root.render(
        <Harness
          markdownRef={markdownRef}
          documentEpochRef={documentEpochRef}
          setAuthorshipMarks={setAuthorshipMarks}
          setPasteReview={setPasteReview}
          validateNow={validateNow}
          pushToast={pushToast}
          onHandlers={(handlers) => {
            latestHandlers = handlers;
          }}
        />,
      );
    });
  }
});

function Harness({
  markdownRef,
  documentEpochRef,
  setAuthorshipMarks,
  setPasteReview,
  validateNow,
  pushToast,
  onHandlers,
}: {
  markdownRef: MutableRefObject<string>;
  documentEpochRef: MutableRefObject<number>;
  setAuthorshipMarks: SetAuthorshipMarks;
  setPasteReview: SetPasteReview;
  validateNow: ValidateNow;
  pushToast: PushToast;
  onHandlers: (handlers: ReturnType<typeof useDocumentDropPaste>) => void;
}) {
  const handlers = useDocumentDropPaste({
    markdownRef,
    documentEpochRef,
    insertImageBlob: vi.fn(),
    insertImageFromPath: vi.fn(),
    openDocumentPath: vi.fn(),
    settleDirtyDocumentBeforeReplace: vi.fn().mockResolvedValue(true),
    commitOpenedDocument: vi.fn<(path: string | null, content: string, metadata: FileMetadata) => void>(),
    validateNow,
    setAuthorshipMarks,
    setPasteReview,
    pushToast,
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
  } as never;
}
