import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../app/runtime';

export interface NativeRecoverySnapshot {
  markdown: string;
  filePath: string | null;
  updatedAtMs: number;
  markdownBytes: number;
}

export interface RendererHeartbeatMetrics {
  sessionId: string;
  documentPath: string | null;
  mode: string | null;
  markdownBytes: number;
  lineCount: number;
  imageCount: number;
  mathCount: number;
  visualAtomCount: number;
  warningCount: number;
  errorCount: number;
  activeBackgroundJobCount: number;
}

export interface RendererHeartbeatStatus {
  previousSessionSuspectedCrash: boolean;
  previousSessionLastSeenMs: number | null;
  diagnosticsDir: string;
}

export interface DiagnosticsEvent {
  eventType: string;
  message: string;
  documentPath?: string | null;
  mode?: string | null;
  markdownBytes?: number | null;
  componentStack?: string | null;
}

export async function writeNativeRecoverySnapshot(snapshot: {
  markdown: string;
  filePath: string | null;
  updatedAtMs: number;
}): Promise<boolean> {
  if (!canUseNativeDiagnostics()) return false;
  try {
    await invoke('write_recovery_snapshot', {
      payload: {
        markdown: snapshot.markdown,
        filePath: snapshot.filePath,
        updatedAtMs: snapshot.updatedAtMs,
      },
    });
    return true;
  } catch (error) {
    console.warn('Native recovery snapshot write failed.', error);
    return false;
  }
}

export async function readNativeRecoverySnapshot(): Promise<NativeRecoverySnapshot | null> {
  if (!canUseNativeDiagnostics()) return null;
  try {
    const snapshot = await invoke<NativeRecoverySnapshot | null>('read_recovery_snapshot');
    return snapshot;
  } catch (error) {
    console.warn('Native recovery snapshot read failed.', error);
    return null;
  }
}

export async function clearNativeRecoverySnapshot(): Promise<boolean> {
  if (!canUseNativeDiagnostics()) return false;
  try {
    await invoke('clear_recovery_snapshot');
    return true;
  } catch (error) {
    console.warn('Native recovery snapshot cleanup failed.', error);
    return false;
  }
}

export async function recordRendererHeartbeat(metrics: RendererHeartbeatMetrics): Promise<RendererHeartbeatStatus | null> {
  if (!canUseNativeDiagnostics()) return null;
  try {
    return await invoke<RendererHeartbeatStatus>('record_renderer_heartbeat', { payload: metrics });
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
        markdownBytes: event.markdownBytes ?? null,
        componentStack: event.componentStack ?? null,
      },
    });
    return true;
  } catch (error) {
    console.warn('Diagnostics event write failed.', error);
    return false;
  }
}

function canUseNativeDiagnostics(): boolean {
  return typeof window !== 'undefined' && isTauriRuntime();
}
