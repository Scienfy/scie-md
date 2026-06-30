import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';
import { exportDiagnosticsBundle } from '../services/nativeRecoveryService';

vi.mock('../services/nativeRecoveryService', () => ({
  appendDiagnosticsEvent: vi.fn(async () => true),
  exportDiagnosticsBundle: vi.fn(async () => ({
    path: 'C:\\Temp\\diagnostics-bundle.json',
    diagnosticsDir: 'C:\\Temp',
    createdAtMs: 1,
    eventCount: 1,
    logBytes: 100,
    recoverySnapshotBytes: null,
    heartbeatSeenAtMs: null,
  })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AppErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.mocked(exportDiagnosticsBundle).mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    consoleErrorSpy.mockRestore();
    alertSpy.mockRestore();
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

  it('lets the recovery screen export a diagnostics bundle', async () => {
    function BrokenEditor(): never {
      throw new Error('render failed');
    }

    act(() => {
      root.render(
        <AppErrorBoundary>
          <BrokenEditor />
        </AppErrorBoundary>,
      );
    });

    const exportButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Export diagnostics');
    expect(exportButton).toBeDefined();

    await act(async () => {
      exportButton?.click();
      await Promise.resolve();
    });

    expect(exportDiagnosticsBundle).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('diagnostics-bundle.json'));
  });
});
