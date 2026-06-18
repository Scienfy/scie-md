import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiffHunks } from '../markdown/diffReview';
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
