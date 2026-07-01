import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPanelErrorBoundary } from './LocalPanelErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LocalPanelErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    consoleError.mockClear();
  });

  it('contains panel render failures locally and resets when the key changes', () => {
    const onError = vi.fn();
    act(() => {
      root.render(
        <LocalPanelErrorBoundary label="JSON health" resetKey="json:1" onError={onError}>
          <ThrowingPanel />
        </LocalPanelErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('JSON health could not render.');
    expect(container.textContent).toContain('panel boom');
    expect(onError).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        <LocalPanelErrorBoundary label="JSON health" resetKey="json:2" onError={onError}>
          <section>Recovered panel</section>
        </LocalPanelErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('Recovered panel');
    expect(container.textContent).not.toContain('could not render');
  });
});

function ThrowingPanel(): never {
  throw new Error('panel boom');
}
