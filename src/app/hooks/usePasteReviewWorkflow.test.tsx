import { act } from 'react';
import { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiffHunks } from '../../markdown/diffReview';
import { createReviewPlan } from '../../markdown/reviewPlan';
import { usePasteReviewWorkflow } from './usePasteReviewWorkflow';
import type { PasteReviewState } from './useDocumentDropPaste';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('usePasteReviewWorkflow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: ReturnType<typeof usePasteReviewWorkflow> | null;
  let latestMarkdown = '';
  let pushToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controls = null;
    latestMarkdown = '';
    pushToast = vi.fn((_text: string, _tone?: 'error' | 'warning' | 'info' | 'success') => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('does not rewrite newer document edits when rejecting a stale paste review', () => {
    const before = 'Original.\n';
    const after = 'Original pasted.\n';
    renderWorkflow({
      initialMarkdown: `${after}Later edit.\n`,
      initialPasteReview: createPasteReview(before, after),
    });

    act(() => {
      controls?.rejectPasteReview();
    });

    expect(latestMarkdown).toBe('Original pasted.\nLater edit.\n');
    expect(pushToast).toHaveBeenCalledWith(
      'Paste review was closed because the document changed after the review was prepared.',
      'warning',
    );
    expect(pushToast).not.toHaveBeenCalledWith('Pasted text edits rejected', 'warning');
  });

  function renderWorkflow(props: {
    initialMarkdown: string;
    initialPasteReview: PasteReviewState | null;
  }) {
    act(() => {
      root.render(
        <Harness
          {...props}
          pushToast={pushToast as never}
          onControls={(nextControls) => {
            controls = nextControls;
          }}
          onMarkdown={(markdown) => {
            latestMarkdown = markdown;
          }}
        />,
      );
    });
  }
});

function Harness({
  initialMarkdown,
  initialPasteReview,
  pushToast,
  onControls,
  onMarkdown,
}: {
  initialMarkdown: string;
  initialPasteReview: PasteReviewState | null;
  pushToast: (text: string, tone?: 'error' | 'warning' | 'info' | 'success') => void;
  onControls: (controls: ReturnType<typeof usePasteReviewWorkflow>) => void;
  onMarkdown: (markdown: string) => void;
}) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [pasteReview, setPasteReview] = useState<PasteReviewState | null>(initialPasteReview);
  const controls = usePasteReviewWorkflow({
    getCurrentMarkdown: () => markdown,
    setMarkdown,
    setAuthorshipMarks: (() => undefined) as never,
    setPasteReview,
    pushToast,
  });
  void pasteReview;
  onMarkdown(markdown);
  onControls(controls);
  return null;
}

function createPasteReview(before: string, after: string): PasteReviewState {
  return {
    before,
    after,
    hunks: createDiffHunks(before, after),
    reviewPlan: createReviewPlan(before, after),
    open: false,
  };
}
