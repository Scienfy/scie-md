import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReviewPlan } from '@sciemd/core';
import { DiffReviewDialog } from './DiffReviewDialog';

vi.mock('../markdown/htmlExport', () => ({
  renderMarkdownHtmlFragment: async (markdown: string) => markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join(''),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DiffReviewDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    patchDialogMethods();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('renders paste review decisions as visual text panes without exposing note metadata', async () => {
    const before = [
      '<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="Original sentence": Tighten. -->',
      '',
      '**Original** sentence.',
      '',
    ].join('\n');
    const after = [
      '_Revised_ sentence.',
      '',
      '<!-- scie_md:note id="human-1" kind="human" target="cursor" source="llm-1": Revised for clarity. -->',
      '',
    ].join('\n');
    const reviewPlan = createReviewPlan(before, after);
    expect(reviewPlan.units[0].afterMarkdown).toContain('_Revised_ sentence.');

    await act(async () => {
      root.render(
        <DiffReviewDialog
          open
          hunks={reviewPlan.rawHunks}
          reviewPlan={reviewPlan}
          onApply={() => undefined}
          onAcceptAll={() => undefined}
          onRejectAll={() => undefined}
          onClose={() => undefined}
        />,
      );
      await Promise.resolve();
    });
    await flushPreviewUpdates();

    expect(container.querySelector('.diff-view-toggle')).toBeNull();
    expect(container.querySelectorAll('.review-preview-pane')).toHaveLength(2);
    expect(container.querySelector('.review-preview-prose strong')?.textContent).toBe('Original');
    expect(container.textContent).toContain('Revised sentence.');
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).not.toContain('scie_md:note');
  });

  it('rejects selected review cards by text edit id rather than raw hunk ids', () => {
    const before = 'Original sentence.\n';
    const after = 'Revised sentence.\n';
    const reviewPlan = createReviewPlan(before, after);
    const onApply = vi.fn();

    act(() => {
      root.render(
        <DiffReviewDialog
          open
          hunks={reviewPlan.rawHunks}
          reviewPlan={reviewPlan}
          onApply={onApply}
          onAcceptAll={() => undefined}
          onRejectAll={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('footer button'))
        .find((button) => button.textContent === 'Reject selected')
        ?.click();
    });

    expect(Array.from(onApply.mock.calls[0][0])).toEqual(['review-1']);
  });

  it('uses a bulk review surface without rendering per-unit previews for very large changes', () => {
    const before = 'Original sentence.\n';
    const after = 'Revised sentence.\n';
    const reviewPlan = createReviewPlan(before, after);
    const onAcceptAll = vi.fn();
    const onApply = vi.fn();

    act(() => {
      root.render(
        <DiffReviewDialog
          open
          hunks={reviewPlan.rawHunks}
          reviewPlan={{ ...reviewPlan, units: [] }}
          largeChangeSummary="This paste is too large for per-edit review."
          onApply={onApply}
          onAcceptAll={onAcceptAll}
          onRejectAll={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain('Large pasted edit');
    expect(container.querySelectorAll('.review-preview-pane')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('footer button')).some((button) => button.textContent === 'Apply review')).toBe(false);

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('footer button'))
        .find((button) => button.textContent === 'Accept selected')
        ?.click();
    });

    expect(onAcceptAll).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('passes raw protected hunk ids when accepting safe changes in bulk review', () => {
    const before = [
      '<!-- scie_md:lock:start reason="approved" -->',
      'Original sentence.',
      '<!-- scie_md:lock:end -->',
      '',
    ].join('\n');
    const after = before.replace('Original sentence.', 'Revised sentence.');
    const reviewPlan = createReviewPlan(before, after);
    const onApply = vi.fn();

    act(() => {
      root.render(
        <DiffReviewDialog
          open
          hunks={reviewPlan.rawHunks}
          reviewPlan={{ ...reviewPlan, units: [] }}
          largeChangeSummary="This paste is too large for per-edit review."
          protectedChanges={[{ hunkId: reviewPlan.rawHunks[0].id, block: {} } as never]}
          onApply={onApply}
          onAcceptAll={() => undefined}
          onRejectAll={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('footer button'))
        .find((button) => button.textContent === 'Accept selected')
        ?.click();
    });

    expect(Array.from(onApply.mock.calls[0][0])).toEqual([]);
    expect(Array.from(onApply.mock.calls[0][1])).toEqual([reviewPlan.rawHunks[0].id]);
  });

  it('keeps deselected protected units rejected when rejecting selected changes', () => {
    const before = [
      '<!-- scie_md:lock:start reason="approved" -->',
      'Original sentence.',
      '<!-- scie_md:lock:end -->',
      '',
    ].join('\n');
    const after = before.replace('Original sentence.', 'Revised sentence.');
    const reviewPlan = createReviewPlan(before, after);
    const onApply = vi.fn();

    act(() => {
      root.render(
        <DiffReviewDialog
          open
          hunks={reviewPlan.rawHunks}
          reviewPlan={reviewPlan}
          protectedChanges={[{ hunkId: reviewPlan.rawHunks[0].id, block: {} } as never]}
          onApply={onApply}
          onAcceptAll={() => undefined}
          onRejectAll={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('footer button'))
        .find((button) => button.textContent === 'Reject selected')
        ?.click();
    });

    expect(Array.from(onApply.mock.calls[0][0])).toEqual([reviewPlan.units[0].id]);
  });
});

async function flushPreviewUpdates() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}

function patchDialogMethods() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
}
