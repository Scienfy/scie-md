import { useMemo, useRef } from 'react';

const DEFAULT_STUCK_AFTER_MS = 30_000;
const MAX_REPORTED_JOB_LABELS = 8;
const MAX_JOB_LABEL_LENGTH = 80;

export interface BackgroundJobSignal {
  id: string;
  label: string;
  active: boolean;
  stuckAfterMs?: number;
}

export interface BackgroundJobEntry {
  id: string;
  label: string;
  startedAtMs: number;
  stuckAfterMs: number;
}

export interface BackgroundJobSnapshot {
  activeJobs: BackgroundJobEntry[];
}

export interface BackgroundJobSummary {
  activeCount: number;
  stuckCount: number;
  oldestBackgroundJobMs: number | null;
  oldestBackgroundJobLabel: string | null;
  activeJobLabels: string[];
  stuckJobLabels: string[];
}

export const EMPTY_BACKGROUND_JOB_SNAPSHOT: BackgroundJobSnapshot = {
  activeJobs: [],
};

export function useBackgroundJobTracker(
  signals: readonly BackgroundJobSignal[],
  now: () => number = Date.now,
): BackgroundJobSnapshot {
  const startedAtByIdRef = useRef(new Map<string, number>());
  return useMemo(
    () => createBackgroundJobSnapshot(signals, startedAtByIdRef.current, now()),
    [now, signals],
  );
}

export function createBackgroundJobSnapshot(
  signals: readonly BackgroundJobSignal[],
  startedAtById: Map<string, number>,
  nowMs: number,
): BackgroundJobSnapshot {
  const activeIds = new Set<string>();
  const activeJobs: BackgroundJobEntry[] = [];

  for (const signal of signals) {
    const id = normalizeJobId(signal.id);
    if (!signal.active || !id || activeIds.has(id)) continue;
    activeIds.add(id);
    const startedAtMs = startedAtById.get(id) ?? nowMs;
    startedAtById.set(id, startedAtMs);
    activeJobs.push({
      id,
      label: normalizeJobLabel(signal.label, id),
      startedAtMs,
      stuckAfterMs: normalizeStuckAfter(signal.stuckAfterMs),
    });
  }

  for (const id of [...startedAtById.keys()]) {
    if (!activeIds.has(id)) startedAtById.delete(id);
  }

  activeJobs.sort((left, right) => left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id));
  return { activeJobs };
}

export function summarizeBackgroundJobs(
  snapshot: BackgroundJobSnapshot,
  nowMs: number,
): BackgroundJobSummary {
  let oldestBackgroundJobMs: number | null = null;
  let oldestBackgroundJobLabel: string | null = null;
  const activeJobLabels: string[] = [];
  const stuckJobLabels: string[] = [];

  for (const job of snapshot.activeJobs) {
    const activeMs = Math.max(0, nowMs - job.startedAtMs);
    if (oldestBackgroundJobMs === null || activeMs > oldestBackgroundJobMs) {
      oldestBackgroundJobMs = activeMs;
      oldestBackgroundJobLabel = job.label;
    }
    if (activeJobLabels.length < MAX_REPORTED_JOB_LABELS) activeJobLabels.push(job.label);
    if (activeMs >= job.stuckAfterMs && stuckJobLabels.length < MAX_REPORTED_JOB_LABELS) {
      stuckJobLabels.push(job.label);
    }
  }

  return {
    activeCount: snapshot.activeJobs.length,
    stuckCount: snapshot.activeJobs.filter((job) => Math.max(0, nowMs - job.startedAtMs) >= job.stuckAfterMs).length,
    oldestBackgroundJobMs,
    oldestBackgroundJobLabel,
    activeJobLabels,
    stuckJobLabels,
  };
}

function normalizeJobId(id: string): string {
  return id.trim();
}

function normalizeJobLabel(label: string, fallback: string): string {
  const normalized = label.trim() || fallback;
  return normalized.length > MAX_JOB_LABEL_LENGTH
    ? `${normalized.slice(0, MAX_JOB_LABEL_LENGTH - 1)}...`
    : normalized;
}

function normalizeStuckAfter(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_STUCK_AFTER_MS;
  return value;
}
