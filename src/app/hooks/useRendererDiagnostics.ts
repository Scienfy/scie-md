import { useEffect, useMemo, useRef } from 'react';
import type { EditorMode } from '../documentState';
import {
  markRendererCleanShutdown,
  recordRendererHeartbeat,
  type RendererHeartbeatMetrics,
} from '../../services/nativeRecoveryService';
import { isTauriRuntime } from '../runtime';

const HEARTBEAT_INTERVAL_MS = 8_000;

interface UseRendererDiagnosticsOptions {
  markdown: string;
  filePath: string | null;
  mode: EditorMode;
  warningCount: number;
  errorCount: number;
  visualAtomCount: number;
  activeBackgroundJobCount: number;
  onPreviousSessionCrashDetected?: () => void;
}

export function useRendererDiagnostics({
  markdown,
  filePath,
  mode,
  warningCount,
  errorCount,
  visualAtomCount,
  activeBackgroundJobCount,
  onPreviousSessionCrashDetected,
}: UseRendererDiagnosticsOptions): void {
  const sessionId = useMemo(() => {
    const random = Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${random}`;
  }, []);
  const latestRef = useRef<UseRendererDiagnosticsOptions>({
    markdown,
    filePath,
    mode,
    warningCount,
    errorCount,
    visualAtomCount,
    activeBackgroundJobCount,
    onPreviousSessionCrashDetected,
  });
  const reportedPreviousCrashRef = useRef(false);

  useEffect(() => {
    latestRef.current = {
      markdown,
      filePath,
      mode,
      warningCount,
      errorCount,
      visualAtomCount,
      activeBackgroundJobCount,
      onPreviousSessionCrashDetected,
    };
  }, [
    activeBackgroundJobCount,
    errorCount,
    filePath,
    markdown,
    mode,
    onPreviousSessionCrashDetected,
    visualAtomCount,
    warningCount,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    let disposed = false;
    const sendHeartbeat = async () => {
      const snapshot = latestRef.current;
      const status = await recordRendererHeartbeat(metricsForMarkdown(sessionId, snapshot));
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
    const timer = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    window.addEventListener('pagehide', markCleanShutdown);
    window.addEventListener('beforeunload', markCleanShutdown);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', markCleanShutdown);
      window.removeEventListener('beforeunload', markCleanShutdown);
      markCleanShutdown();
    };
  }, [sessionId]);
}

function metricsForMarkdown(
  sessionId: string,
  snapshot: UseRendererDiagnosticsOptions,
): RendererHeartbeatMetrics {
  return {
    sessionId,
    documentPath: snapshot.filePath,
    mode: snapshot.mode,
    markdownBytes: byteLength(snapshot.markdown),
    lineCount: lineCount(snapshot.markdown),
    imageCount: countMatches(snapshot.markdown, /!\[[^\]]*]\(/g) + countMatches(snapshot.markdown, /<img\b/gi),
    mathCount: countMatches(snapshot.markdown, /\$\$?[^$\n]/g),
    visualAtomCount: snapshot.visualAtomCount,
    warningCount: snapshot.warningCount,
    errorCount: snapshot.errorCount,
    activeBackgroundJobCount: snapshot.activeBackgroundJobCount,
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
