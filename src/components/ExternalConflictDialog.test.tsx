import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiffHunks } from '@sciemd/core';
import { ExternalConflictDialog } from './ExternalConflictDialog';

vi.mock('../markdown/htmlExport', () => ({
  renderMarkdownHtmlFragment: async (markdown: string) => markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join(''),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ExternalConflictDialog', () => {
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

  it('keeps normal disk reviews focused by expanding the first changed card', () => {
    const hunks = createDiffHunks('Original sentence.\n', 'Revised sentence.\n');

    act(() => {
      root.render(
        <ExternalConflictDialog
          open
          hunks={hunks}
          onApplyReview={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    expect(container.textContent).not.toContain('Large disk change set');
    expect(container.querySelectorAll('.review-change-card.expanded')).toHaveLength(1);
    expect(container.querySelectorAll('.review-preview-pane')).toHaveLength(2);
  });

  it('keeps many disk-change cards collapsed until the user opens one', () => {
    const { before, after } = createIndependentLineChanges(14);
    const hunks = createDiffHunks(before, after);
    const onFocusLine = vi.fn();

    expect(hunks.length).toBeGreaterThanOrEqual(12);

    act(() => {
      root.render(
        <ExternalConflictDialog
          open
          hunks={hunks}
          onApplyReview={() => undefined}
          onClose={() => undefined}
          onFocusLine={onFocusLine}
        />,
      );
    });

    expect(container.textContent).toContain('Large disk change set');
    expect(container.querySelectorAll('.review-change-card')).toHaveLength(hunks.length);
    expect(container.querySelectorAll('.review-change-card.expanded')).toHaveLength(0);
    expect(container.querySelectorAll('.review-preview-pane')).toHaveLength(0);
    expect(onFocusLine).not.toHaveBeenCalled();

    act(() => {
      container.querySelector<HTMLButtonElement>('.review-change-summary')?.click();
    });

    expect(container.querySelectorAll('.review-change-card.expanded')).toHaveLength(1);
    expect(container.querySelectorAll('.review-preview-pane')).toHaveLength(2);
    expect(onFocusLine).toHaveBeenCalledTimes(1);
  });

  it('also keeps one line-heavy disk change collapsed on open', () => {
    const before = Array.from({ length: 85 }, (_, index) => `Original line ${index + 1}`).join('\n');
    const after = Array.from({ length: 85 }, (_, index) => `Revised line ${index + 1}`).join('\n');
    const hunks = createDiffHunks(before, after);

    act(() => {
      root.render(
        <ExternalConflictDialog
          open
          hunks={hunks}
          onApplyReview={() => undefined}
          onClose={() => undefined}
        />,
      );
    });

    expect(hunks).toHaveLength(1);
    expect(container.textContent).toContain('Large disk change set');
    expect(container.querySelectorAll('.review-change-card.expanded')).toHaveLength(0);
    expect(container.querySelectorAll('.review-preview-pane')).toHaveLength(0);
  });

  it('keeps deselected protected disk hunks rejected when rejecting selected changes', () => {
    const before = [
      '<!-- scie_md:lock:start reason="approved" -->',
      'Original sentence.',
      '<!-- scie_md:lock:end -->',
      '',
    ].join('\n');
    const after = before.replace('Original sentence.', 'Revised sentence.');
    const hunks = createDiffHunks(before, after);
    const onApplyReview = vi.fn();

    act(() => {
      root.render(
        <ExternalConflictDialog
          open
          hunks={hunks}
          protectedChanges={[{ hunkId: hunks[0].id, block: {} } as never]}
          onApplyReview={onApplyReview}
          onClose={() => undefined}
        />,
      );
    });

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('footer button'))
        .find((button) => button.textContent === 'Reject selected')
        ?.click();
    });

    expect(Array.from(onApplyReview.mock.calls[0][0])).toEqual([hunks[0].id]);
  });
});

function createIndependentLineChanges(changeCount: number): { before: string; after: string } {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  for (let index = 0; index < changeCount; index += 1) {
    beforeLines.push(`Stable bridge ${index + 1}`);
    afterLines.push(`Stable bridge ${index + 1}`);
    beforeLines.push(`Original clause ${index + 1}`);
    afterLines.push(`Revised clause ${index + 1}`);
  }
  beforeLines.push('Final stable line');
  afterLines.push('Final stable line');
  return {
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
  };
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
