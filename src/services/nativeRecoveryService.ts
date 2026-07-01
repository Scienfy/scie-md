import { invoke } from '@tauri-apps/api/core';
import type { DocumentFormat } from '@sciemd/core';
import { isTauriRuntime } from '../app/runtime';

export interface NativeRecoverySnapshot {
  schemaVersion?: number;
  sourceText?: string;
  /** @deprecated Native snapshots keep this field for recovery compatibility. */
  markdown: string;
  filePath: string | null;
  format?: DocumentFormat;
  updatedAtMs: number;
  sourceTextBytes?: number;
  /** @deprecated Native diagnostics payloads still serialize this as markdownBytes. */
  markdownBytes: number;
}

export interface RendererHeartbeatMetrics {
  sessionId: string;
  documentPath: string | null;
  mode: string | null;
  sourceTextBytes: number;
  lineCount: number;
  imageCount: number;
  mathCount: number;
  visualAtomCount: number;
  warningCount: number;
  errorCount: number;
  activeBackgroundJobCount: number;
  stuckBackgroundJobCount: number;
  oldestBackgroundJobMs: number | null;
  backgroundJobLabels: string[];
  stuckBackgroundJobLabels: string[];
}

export interface RendererHeartbeatStatus {
  previousSessionSuspectedCrash: boolean;
  previousSessionLastSeenMs: number | null;
  diagnosticsDir: string;
}

export interface DiagnosticsBundleMetadata {
  path: string;
  diagnosticsDir: string;
  createdAtMs: number;
  eventCount: number;
  logBytes: number;
  recoverySnapshotBytes: number | null;
  heartbeatSeenAtMs: number | null;
}

export interface DiagnosticsEvent {
  eventType: string;
  message: string;
  documentPath?: string | null;
  mode?: string | null;
  sourceTextBytes?: number | null;
  /** @deprecated Use sourceTextBytes at app/service boundaries. */
  markdownBytes?: number | null;
  componentStack?: string | null;
}

export async function writeNativeRecoverySnapshot(snapshot: {
  sourceText?: string;
  markdown?: string;
  filePath: string | null;
  format?: DocumentFormat;
  updatedAtMs: number;
}): Promise<boolean> {
  if (!canUseNativeDiagnostics()) return false;
  const sourceText = snapshot.sourceText ?? snapshot.markdown ?? '';
  try {
    await invoke('write_recovery_snapshot', {
      payload: {
        schemaVersion: 2,
        markdown: sourceText,
        filePath: snapshot.filePath,
        format: snapshot.format ?? 'markdown',
        updatedAtMs: snapshot.updatedAtMs,
      },
    });
    return true;
  } catch (error) {
    console.warn('Native recovery snapshot write failed.', error);
    return false;
  }
}

export async function readNativeRecoverySnapshot(filePath?: string | null): Promise<NativeRecoverySnapshot | null> {
  if (!canUseNativeDiagnostics()) return null;
  try {
    const snapshot = await invoke<NativeRecoverySnapshot | null>('read_recovery_snapshot', {
      filePath: filePath ?? null,
      latest: filePath === undefined,
    });
    return snapshot;
  } catch (error) {
    console.warn('Native recovery snapshot read failed.', error);
    return null;
  }
}

export async function clearNativeRecoverySnapshot(filePath?: string | null): Promise<boolean> {
  if (!canUseNativeDiagnostics()) return false;
  try {
    await invoke('clear_recovery_snapshot', {
      filePath: filePath ?? null,
      latest: filePath === undefined,
    });
    return true;
  } catch (error) {
    console.warn('Native recovery snapshot cleanup failed.', error);
    return false;
  }
}

export async function recordRendererHeartbeat(metrics: RendererHeartbeatMetrics): Promise<RendererHeartbeatStatus | null> {
  if (!canUseNativeDiagnostics()) return null;
  try {
    return await invoke<RendererHeartbeatStatus>('record_renderer_heartbeat', {
      payload: {
        ...metrics,
        markdownBytes: metrics.sourceTextBytes,
      },
    });
  } catch (error) {
    console.warn('Renderer heartbeat write failed.', error);
    return null;
  }
}

export async function markRendererCleanShutdown(sessionId: string): Promise<boolean> {
  if (!canUseNativeDiagnostics()) return false;
  try {
    await invoke('mark_renderer_clean_shutdown', { sessionId });
    return true;
  } catch {
    return false;
  }
}

export async function appendDiagnosticsEvent(event: DiagnosticsEvent): Promise<boolean> {
  if (!canUseNativeDiagnostics()) return false;
  try {
    await invoke('append_diagnostics_event', {
      payload: {
        eventType: event.eventType,
        message: event.message,
        documentPath: event.documentPath ?? null,
        mode: event.mode ?? null,
        markdownBytes: event.sourceTextBytes ?? event.markdownBytes ?? null,
        componentStack: event.componentStack ?? null,
      },
    });
    return true;
  } catch (error) {
    console.warn('Diagnostics event write failed.', error);
    return false;
  }
}

export async function exportDiagnosticsBundle(): Promise<DiagnosticsBundleMetadata | null> {
  if (!canUseNativeDiagnostics()) return null;
  try {
    return await invoke<DiagnosticsBundleMetadata>('export_diagnostics_bundle');
  } catch (error) {
    console.warn('Diagnostics bundle export failed.', error);
    return null;
  }
}

function canUseNativeDiagnostics(): boolean {
  return typeof window !== 'undefined' && isTauriRuntime();
}
