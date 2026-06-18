import { act, createRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalShell } from './ModalShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ModalShell', () => {
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

  it('locks body scroll and restores focus when closed', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    act(() => {
      root.render(
        <ModalShell open titleId="modal-title" onCancel={() => undefined}>
          <h2 id="modal-title">Dialog</h2>
          <button type="button">First</button>
        </ModalShell>,
      );
    });

    expect(document.body.style.overflow).toBe('hidden');
    act(() => {
      root.render(
        <ModalShell open={false} titleId="modal-title" onCancel={() => undefined}>
          <h2 id="modal-title">Dialog</h2>
        </ModalShell>,
      );
    });

    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('keeps tab focus inside the dialog from the first tab stop', () => {
    const lastRef = createRef<HTMLButtonElement>();
    act(() => {
      root.render(
        <ModalShell open titleId="modal-title" onCancel={() => undefined}>
          <h2 id="modal-title">Dialog</h2>
          <button type="button">First</button>
          <button ref={lastRef} type="button">Last</button>
        </ModalShell>,
      );
    });
    act(() => vi.runOnlyPendingTimers());

    const first = container.querySelector('button')!;
    first.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastRef.current);
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
