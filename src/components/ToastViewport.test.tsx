import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastViewport } from './ToastViewport';
import type { ToastMessage } from './ToastViewport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ToastViewport', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('splits error toasts into an assertive persistent live region', () => {
    const toasts: ToastMessage[] = [
      { id: 1, tone: 'success', text: 'Saved', durationMs: 4500 },
      { id: 2, tone: 'error', text: 'Save failed', durationMs: null },
    ];

    act(() => {
      root.render(<ToastViewport toasts={toasts} onDismiss={() => undefined} onPause={() => undefined} onResume={() => undefined} />);
    });

    expect(container.querySelector('[role="status"]')?.textContent).toContain('Saved');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Save failed');
    expect(container.querySelector('.toast.error')?.classList.contains('is-persistent')).toBe(true);
  });

  it('pauses and resumes dismiss timers from pointer hover', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const toasts: ToastMessage[] = [{ id: 7, tone: 'info', text: 'Copied', durationMs: 4500 }];

    act(() => {
      root.render(<ToastViewport toasts={toasts} onDismiss={() => undefined} onPause={onPause} onResume={onResume} />);
    });

    const toast = container.querySelector('.toast')!;
    toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

    expect(onPause).toHaveBeenCalledWith(7);
    expect(onResume).toHaveBeenCalledWith(7);
  });
});
