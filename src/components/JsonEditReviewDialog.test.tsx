import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonEditSourcePreview, planJsonVisualEdit } from '@sciemd/core';
import { JsonEditReviewDialog } from './JsonEditReviewDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('JsonEditReviewDialog', () => {
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
    vi.restoreAllMocks();
  });

  it('renders bounded before/after snippets and forwards apply/cancel actions', () => {
    const source = '{\n  "meta": {}\n}\n';
    const plan = planJsonVisualEdit(source, {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'status',
      value: 'draft',
    });
    const preview = createJsonEditSourcePreview(source, plan);
    const onApply = vi.fn();
    const onCancel = vi.fn();

    act(() => {
      root.render(
        <JsonEditReviewDialog
          open
          preview={preview}
          schemaGeneratedValueExplanation="Generates $.meta.settings from required schema fields: enabled."
          onApply={onApply}
          onCancel={onCancel}
        />,
      );
    });

    expect(container.textContent).toContain('Review JSON Source Change');
    expect(container.textContent).toContain('Added $.meta.status.');
    expect(container.textContent).toContain('Schema Generated Value');
    expect(container.textContent).toContain('required schema fields');
    expect(container.textContent).toContain('"meta": {}');
    expect(container.textContent).toContain('"status": "draft"');

    clickButton('Apply JSON change');
    expect(onApply).toHaveBeenCalledTimes(1);

    clickButton('Close JSON source review');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing without an open preview', () => {
    act(() => {
      root.render(
        <JsonEditReviewDialog
          open={false}
          preview={null}
          onApply={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toBe('');
  });
});

function clickButton(label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent === label || candidate.getAttribute('aria-label') === label);
  expect(button, `button "${label}"`).not.toBeUndefined();
  act(() => {
    button?.click();
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
