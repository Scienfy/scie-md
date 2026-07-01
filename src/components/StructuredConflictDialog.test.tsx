import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonStructuralReview, createStructuredEditReviewPlan, createStructuredExternalConflictReview, planJsonVisualEdit, structuredEditTransactionFromJsonEdit } from '@sciemd/core';
import { StructuredConflictDialog } from './StructuredConflictDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('StructuredConflictDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  it('shows source-safe conflict actions for structured files', () => {
    const onKeepCurrent = vi.fn();
    const onReloadDisk = vi.fn();
    const onSaveAs = vi.fn();
    const onSaveAnyway = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="JSON"
          filePath={'C:\\docs\\results.json'}
          currentSource={'{"local":true}\n'}
          diskSource={'{"disk":"é"}\n'}
          onKeepCurrent={onKeepCurrent}
          onReloadDisk={onReloadDisk}
          onSaveAs={onSaveAs}
          onSaveAnyway={onSaveAnyway}
          onClose={onClose}
        />,
      );
    });

    expect(container.querySelector('#structured-conflict-title')?.textContent).toBe('Source Conflict');
    expect(container.textContent).toContain('Structured files are not line-merged with conflict markers.');
    expect(container.textContent).toContain('JSON');
    expect(container.textContent).toContain('C:\\docs\\results.json');

    clickButton(container, 'Keep Current');
    clickButton(container, 'Reload Disk');
    clickButton(container, 'Save As');
    clickButton(container, 'Save Anyway');
    clickButton(container, 'Close source conflict');

    expect(onKeepCurrent).toHaveBeenCalledTimes(1);
    expect(onReloadDisk).toHaveBeenCalledTimes(1);
    expect(onSaveAs).toHaveBeenCalledTimes(1);
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders JSON path review and applies selected disk paths', () => {
    const onApplyJsonReview = vi.fn();
    const review = createJsonStructuralReview(
      '{"name":"base","count":1}\n',
      '{"name":"local","count":1}\n',
      '{"name":"disk","count":2}\n',
    );

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="JSON"
          filePath={'C:\\docs\\results.json'}
          currentSource={'{"name":"local","count":1}\n'}
          diskSource={'{"name":"disk","count":2}\n'}
          jsonReview={review}
          onKeepCurrent={vi.fn()}
          onReloadDisk={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAnyway={vi.fn()}
          onApplyJsonReview={onApplyJsonReview}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('JSON Path Review');
    expect(container.textContent).toContain('$.name');
    expect(container.textContent).toContain('"local"');
    expect(container.textContent).toContain('"disk"');

    togglePath(container, '$.name');
    clickButton(container, 'Apply Selected Paths');

    const rejected = onApplyJsonReview.mock.calls[0][0] as Set<string>;
    expect(Array.from(rejected)).toEqual([
      review.entries.find((entry) => entry.displayPath === '$.name')?.id,
    ]);
  });

  it('shows shared structured review metadata when supplied', () => {
    const source = '{"study":{"title":"old"}}\n';
    const intent = { kind: 'replaceScalar' as const, path: ['study', 'title'], nextValue: 'new' };
    const plan = planJsonVisualEdit(source, intent);
    const transaction = structuredEditTransactionFromJsonEdit(source, intent, plan);
    const reviewPlan = transaction
      ? createStructuredEditReviewPlan({ source, transaction, documentEpoch: 7 })
      : null;
    expect(reviewPlan).not.toBeNull();

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="JSON"
          filePath={'C:\\docs\\results.json'}
          currentSource={source}
          diskSource={'{"study":{"title":"disk"}}\n'}
          reviewPlan={reviewPlan}
          onKeepCurrent={vi.fn()}
          onReloadDisk={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAnyway={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Review');
    expect(container.textContent).toContain('Updated $.study.title.');
    expect(container.textContent).toContain('Target');
    expect(container.textContent).toContain('$.study.title');
    expect(container.textContent).toContain('Risk');
  });

  it('shows JSON structural fallback diagnostics when path review is unavailable', () => {
    const review = createJsonStructuralReview(
      '{"name":"base"}\n',
      '{"name":"local"}\n',
      '{"name":}\n',
    );

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="JSON"
          filePath={'C:\\docs\\results.json'}
          currentSource={'{"name":"local"}\n'}
          diskSource={'{"name":}\n'}
          jsonReview={review}
          onKeepCurrent={vi.fn()}
          onReloadDisk={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAnyway={vi.fn()}
          onApplyJsonReview={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Path Review Unavailable');
    expect(container.textContent).toContain('Both current and disk JSON must parse');
    expect(container.textContent).toContain('Disk JSON');
  });

  it('renders structured external review entries and applies selected changes', () => {
    const onApplyStructuredReview = vi.fn();
    const review = createStructuredExternalConflictReview(
      'csv',
      'sample_id,note,count\nS-001,base,10\n',
      'sample_id,note,count\nS-001,local,10\n',
      'sample_id,note,count\nS-001,"thin, film",10\n',
    );

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="CSV"
          filePath={'C:\\docs\\samples.csv'}
          currentSource={'sample_id,note,count\nS-001,local,10\n'}
          diskSource={'sample_id,note,count\nS-001,"thin, film",10\n'}
          externalReview={review}
          onKeepCurrent={vi.fn()}
          onReloadDisk={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAnyway={vi.fn()}
          onApplyStructuredReview={onApplyStructuredReview}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Table Cell Review');
    expect(container.textContent).toContain('Row 1, note');
    expect(container.textContent).toContain('"thin, film"');

    togglePath(container, 'Row 1, note');
    clickButton(container, 'Apply Selected Changes');

    const rejected = onApplyStructuredReview.mock.calls[0][0] as Set<string>;
    expect(Array.from(rejected)).toEqual([
      review.entries.find((entry) => entry.displayTarget === 'Row 1, note')?.id,
    ]);
  });

  it('renders YAML path review entries through the shared structured review panel', () => {
    const onApplyStructuredReview = vi.fn();
    const review = createStructuredExternalConflictReview(
      'yaml',
      'study:\n  title: base\n  count: 1\n',
      'study:\n  title: local\n  count: 1\n',
      'study:\n  title: disk\n  count: 2\n',
    );

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="YAML"
          filePath={'C:\\docs\\study.yaml'}
          currentSource={'study:\n  title: local\n  count: 1\n'}
          diskSource={'study:\n  title: disk\n  count: 2\n'}
          externalReview={review}
          onKeepCurrent={vi.fn()}
          onReloadDisk={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAnyway={vi.fn()}
          onApplyStructuredReview={onApplyStructuredReview}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('YAML Path Review');
    expect(container.textContent).toContain('$.study.count');
    expect(container.textContent).toContain('$.study.title');
    expect(container.textContent).toContain('local edit also touched this target');

    togglePath(container, '$.study.title');
    clickButton(container, 'Apply Selected Changes');

    const rejected = onApplyStructuredReview.mock.calls[0][0] as Set<string>;
    expect(Array.from(rejected)).toEqual([
      review.entries.find((entry) => entry.displayTarget === '$.study.title')?.id,
    ]);
  });

  it('renders source-only fallback preview for non-mergeable structured conflicts', () => {
    const review = createStructuredExternalConflictReview(
      'yaml',
      'items:\n  - base\n',
      'items:\n  - local\n',
      'items:\n  - disk\n  - added\n',
    );

    act(() => {
      root.render(
        <StructuredConflictDialog
          open
          formatLabel="YAML"
          filePath={'C:\\docs\\study.yaml'}
          currentSource={'items:\n  - local\n'}
          diskSource={'items:\n  - disk\n  - added\n'}
          externalReview={review}
          onKeepCurrent={vi.fn()}
          onReloadDisk={vi.fn()}
          onSaveAs={vi.fn()}
          onSaveAnyway={vi.fn()}
          onApplyStructuredReview={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Structured Review Unavailable');
    expect(container.textContent).toContain('existing scalar value changes only');
    expect(container.textContent).toContain('items:');
    expect(container.textContent).toContain('added');
  });
});

function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(label) || candidate.getAttribute('aria-label') === label);
  if (!button) throw new Error(`button not found: ${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function togglePath(container: HTMLElement, path: string) {
  const label = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.textContent?.includes(path));
  const checkbox = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error(`checkbox not found: ${path}`);
  act(() => {
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
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
