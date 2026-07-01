import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_BACKGROUND_JOB_SNAPSHOT,
  createBackgroundJobSnapshot,
  type BackgroundJobSnapshot,
} from '../backgroundJobs';
import { recordRendererHeartbeat } from '../../services/nativeRecoveryService';
import {
  summarizeSourceTextForDiagnostics,
  useRendererDiagnostics,
  type RendererDocumentMetrics,
} from './useRendererDiagnostics';

vi.mock('../../services/nativeRecoveryService', () => ({
  recordRendererHeartbeat: vi.fn(async () => null),
  markRendererCleanShutdown: vi.fn(async () => true),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtimeWindow = window as Window & { __TAURI_INTERNALS__?: unknown };

describe('useRendererDiagnostics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(recordRendererHeartbeat).mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    delete runtimeWindow.__TAURI_INTERNALS__;
    vi.useRealTimers();
  });

  it('caches full-document metrics outside the heartbeat interval', async () => {
    const metricsFactory = vi.fn<(sourceText: string) => RendererDocumentMetrics>((sourceText) => summarizeSourceTextForDiagnostics(sourceText));

    renderHarness({
      sourceText: '# Paper\n\n![Figure](figure.png)\n\nInline $x$',
      createDocumentMetrics: metricsFactory,
    });
    await flushEffects();

    expect(metricsFactory).toHaveBeenCalledTimes(1);
    expect(recordRendererHeartbeat).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(recordRendererHeartbeat).toHaveBeenCalledTimes(4);
    expect(metricsFactory).toHaveBeenCalledTimes(1);

    renderHarness({
      sourceText: '# Revised\n\n<img src="plot.png">\n\n$$y$$',
      createDocumentMetrics: metricsFactory,
    });
    await flushEffects();

    expect(metricsFactory).toHaveBeenCalledTimes(2);
  });

  it('includes active and stuck background job accounting in heartbeats', async () => {
    const startedAtById = new Map<string, number>();
    const backgroundJobs = createBackgroundJobSnapshot([
      { id: 'export', label: 'HTML export', active: true, stuckAfterMs: 500 },
    ], startedAtById, 1_000);

    renderHarness({
      sourceText: '# Paper',
      backgroundJobs,
      now: () => 1_750,
    });
    await flushEffects();

    expect(recordRendererHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      activeBackgroundJobCount: 1,
      stuckBackgroundJobCount: 1,
      oldestBackgroundJobMs: 750,
      backgroundJobLabels: ['HTML export'],
      stuckBackgroundJobLabels: ['HTML export'],
    }));
  });

  function renderHarness(props: {
    sourceText: string;
    backgroundJobs?: BackgroundJobSnapshot;
    createDocumentMetrics?: (sourceText: string) => RendererDocumentMetrics;
    now?: () => number;
  }) {
    act(() => {
      root.render(
        <Harness
          sourceText={props.sourceText}
          backgroundJobs={props.backgroundJobs ?? EMPTY_BACKGROUND_JOB_SNAPSHOT}
          createDocumentMetrics={props.createDocumentMetrics}
          now={props.now}
        />,
      );
    });
  }
});

function Harness({
  sourceText,
  backgroundJobs,
  createDocumentMetrics,
  now,
}: {
  sourceText: string;
  backgroundJobs: BackgroundJobSnapshot;
  createDocumentMetrics?: (sourceText: string) => RendererDocumentMetrics;
  now?: () => number;
}) {
  useRendererDiagnostics({
    sourceText,
    filePath: 'C:\\Lab\\paper.md',
    mode: 'visual',
    warningCount: 0,
    errorCount: 0,
    visualAtomCount: 0,
    backgroundJobs,
    createDocumentMetrics,
    heartbeatIntervalMs: 1_000,
    now,
  });
  return null;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}
