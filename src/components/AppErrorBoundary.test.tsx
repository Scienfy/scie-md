import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AppErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    consoleErrorSpy.mockRestore();
  });

  it('logs background promise rejections without replacing the editor with the recovery screen', () => {
    act(() => {
      root.render(
        <AppErrorBoundary>
          <div>Editor ready</div>
        </AppErrorBoundary>,
      );
    });

    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', {
      configurable: true,
      value: new Error('idle watcher failed'),
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(container.textContent).toContain('Editor ready');
    expect(container.textContent).not.toContain('ScieMD recovered an app error');
  });
});
