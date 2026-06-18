import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkDialog } from './LinkDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LinkDialog', () => {
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
  });

  it('submits link text and destination together', () => {
    const onSubmit = vi.fn();
    act(() => {
      root.render(
        <LinkDialog
          open
          initialText=""
          onSubmit={onSubmit}
          onCancel={() => undefined}
        />,
      );
    });

    const inputs = Array.from(container.querySelectorAll('input'));
    act(() => {
      setInputValue(inputs[0], 'Dataset portal');
      setInputValue(inputs[1], 'https://example.org/data');
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onSubmit).toHaveBeenCalledWith({
      text: 'Dataset portal',
      url: 'https://example.org/data',
    });
  });
});

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
