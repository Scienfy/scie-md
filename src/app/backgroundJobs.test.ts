import { describe, expect, it } from 'vitest';
import {
  createBackgroundJobSnapshot,
  summarizeBackgroundJobs,
  type BackgroundJobSignal,
} from './backgroundJobs';

describe('background job accounting', () => {
  it('keeps active job start times stable across repeated snapshots', () => {
    const starts = new Map<string, number>();
    const firstSignals: BackgroundJobSignal[] = [
      { id: 'parser', label: 'Document parser', active: true, stuckAfterMs: 1_000 },
    ];
    const secondSignals: BackgroundJobSignal[] = [
      { id: 'parser', label: 'Parser still running', active: true, stuckAfterMs: 1_000 },
    ];

    const first = createBackgroundJobSnapshot(firstSignals, starts, 100);
    const second = createBackgroundJobSnapshot(secondSignals, starts, 750);

    expect(first.activeJobs[0]).toMatchObject({ id: 'parser', startedAtMs: 100 });
    expect(second.activeJobs[0]).toMatchObject({
      id: 'parser',
      label: 'Parser still running',
      startedAtMs: 100,
    });
  });

  it('reports active and stuck job timing without rescanning app state', () => {
    const starts = new Map<string, number>();
    createBackgroundJobSnapshot([
      { id: 'save', label: 'Save queue', active: true, stuckAfterMs: 500 },
    ], starts, 500);
    const snapshot = createBackgroundJobSnapshot([
      { id: 'save', label: 'Save queue', active: true, stuckAfterMs: 500 },
      { id: 'export', label: 'HTML export', active: true, stuckAfterMs: 2_000 },
      { id: 'validator', label: 'Document validation', active: false },
    ], starts, 1_000);

    const summary = summarizeBackgroundJobs(snapshot, 1_750);

    expect(summary).toEqual({
      activeCount: 2,
      stuckCount: 1,
      oldestBackgroundJobMs: 1_250,
      oldestBackgroundJobLabel: 'Save queue',
      activeJobLabels: ['Save queue', 'HTML export'],
      stuckJobLabels: ['Save queue'],
    });
  });

  it('removes completed jobs from the tracked start map', () => {
    const starts = new Map<string, number>();
    createBackgroundJobSnapshot([
      { id: 'save', label: 'Save queue', active: true },
    ], starts, 100);

    const completed = createBackgroundJobSnapshot([
      { id: 'save', label: 'Save queue', active: false },
    ], starts, 200);

    expect(completed.activeJobs).toEqual([]);
    expect(starts.has('save')).toBe(false);
  });
});
