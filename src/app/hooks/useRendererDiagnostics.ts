import { useEffect, useMemo, useRef } from 'react';
import type { EditorMode } from '../documentState';
import {
  markRendererCleanShutdown,
  recordRendererHeartbeat,
  type RendererHeartbeatMetrics,
} from '../../services/nativeRecoveryService';
import { isTauriRuntime } from '../runtime';
import {
  EMPTY_BACKGROUND_JOB_SNAPSHOT,
  summarizeBackgroundJobs,
  type BackgroundJobSnapshot,
} from '../backgroundJobs';

const HEARTBEAT_INTERVAL_MS = 8_000;

interface UseRendererDiagnosticsOptions {
  markdown: string;
  filePath: string | null;
  mode: EditorMode;
  warningCount: number;
  errorCount: number;
  visualAtomCount: number;
  backgroundJobs?: BackgroundJobSnapshot;
  onPreviousSessionCrashDetected?: () => void;
  createDocumentMetrics?: (markdown: string) => RendererDocumentMetrics;
  heartbeatIntervalMs?: number;
  now?: () => number;
}

export interface RendererDocumentMetrics {
  markdownBytes: number;
  lineCount: number;
  imageCount: number;
  mathCount: number;
}

interface RendererDiagnosticsSnapshot {
  filePath: string | null;
  mode: EditorMode;
  warningCount: number;
  errorCount: number;
  visualAtomCount: number;
  documentMetrics: RendererDocumentMetrics;
  backgroundJobs: BackgroundJobSnapshot;
  onPreviousSessionCrashDetected?: () => void;
}

export function useRendererDiagnostics({
  markdown,
  filePath,
  mode,
  warningCount,
  errorCount,
  visualAtomCount,
  backgroundJobs = EMPTY_BACKGROUND_JOB_SNAPSHOT,
  onPreviousSessionCrashDetected,
  createDocumentMetrics = summarizeMarkdownForDiagnostics,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  now = Date.now,
}: UseRendererDiagnosticsOptions): void {
  const sessionId = useMemo(() => {
    const random = Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${random}`;
  }, []);
  const documentMetrics = useMemo(
    () => createDocumentMetrics(markdown),
    [createDocumentMetrics, markdown],
  );
  const latestSnapshot = useMemo<RendererDiagnosticsSnapshot>(() => ({
    filePath,
    mode,
    warningCount,
    errorCount,
    visualAtomCount,
    documentMetrics,
    backgroundJobs,
    onPreviousSessionCrashDetected,
  }), [
    backgroundJobs,
    documentMetrics,
    errorCount,
    filePath,
    mode,
    onPreviousSessionCrashDetected,
    visualAtomCount,
    warningCount,
  ]);
  const latestRef = useRef<RendererDiagnosticsSnapshot>(latestSnapshot);
  const reportedPreviousCrashRef = useRef(false);

  useEffect(() => {
    latestRef.current = latestSnapshot;
  }, [latestSnapshot]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    const sendHeartbeat = async () => {
      const snapshot = latestRef.current;
      const status = await recordRendererHeartbeat(metricsForSnapshot(sessionId, snapshot, now()));
      if (
        status?.previousSessionSuspectedCrash
        && !reportedPreviousCrashRef.current
        && !disposed
      ) {
        reportedPreviousCrashRef.current = true;
        snapshot.onPreviousSessionCrashDetected?.();
      }
    };
    const markCleanShutdown = () => {
      void markRendererCleanShutdown(sessionId);
    };

    void sendHeartbeat();
    const timer = window.setInterval(() => void sendHeartbeat(), heartbeatIntervalMs);
    window.addEventListener('pagehide', markCleanShutdown);
    window.addEventListener('beforeunload', markCleanShutdown);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', markCleanShutdown);
      window.removeEventListener('beforeunload', markCleanShutdown);
      markCleanShutdown();
    };
  }, [heartbeatIntervalMs, now, sessionId]);
}

function metricsForSnapshot(
  sessionId: string,
  snapshot: RendererDiagnosticsSnapshot,
  nowMs: number,
): RendererHeartbeatMetrics {
  const backgroundJobSummary = summarizeBackgroundJobs(snapshot.backgroundJobs, nowMs);
  return {
    sessionId,
    documentPath: snapshot.filePath,
    mode: snapshot.mode,
    markdownBytes: snapshot.documentMetrics.markdownBytes,
    lineCount: snapshot.documentMetrics.lineCount,
    imageCount: snapshot.documentMetrics.imageCount,
    mathCount: snapshot.documentMetrics.mathCount,
    visualAtomCount: snapshot.visualAtomCount,
    warningCount: snapshot.warningCount,
    errorCount: snapshot.errorCount,
    activeBackgroundJobCount: backgroundJobSummary.activeCount,
    stuckBackgroundJobCount: backgroundJobSummary.stuckCount,
    oldestBackgroundJobMs: backgroundJobSummary.oldestBackgroundJobMs,
    backgroundJobLabels: backgroundJobSummary.activeJobLabels,
    stuckBackgroundJobLabels: backgroundJobSummary.stuckJobLabels,
  };
}

export function summarizeMarkdownForDiagnostics(markdown: string): RendererDocumentMetrics {
  return {
    markdownBytes: byteLength(markdown),
    lineCount: lineCount(markdown),
    imageCount: countMatches(markdown, /!\[[^\]]*]\(/g) + countMatches(markdown, /<img\b/gi),
    mathCount: countMatches(markdown, /\$\$?[^$\n]/g),
  };
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r\n|\r|\n/).length;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}
