import type { RecoveryHost } from '../host/documentHost';
import { displayNameForPath } from './controller';

export async function loadFileDraftWithTimeout(recoveryHost: RecoveryHost, path: string, timeoutMs: number) {
  try {
    return await withTimeout(
      recoveryHost.loadFileDraft(path),
      timeoutMs,
      `Recovery draft lookup for ${displayNameForPath(path)} took too long.`,
    );
  } catch (error) {
    recordDocumentOpenDiagnostic(
      recoveryHost,
      'document-open-draft-check-skipped',
      error instanceof Error ? error.message : 'Recovery draft lookup was skipped.',
      path,
    );
    return null;
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

export function recordDocumentOpenDiagnostic(
  recoveryHost: RecoveryHost,
  eventType: string,
  message: string,
  documentPath?: string | null,
  markdown?: string,
): void {
  void recoveryHost.appendDiagnosticsEvent({
    eventType,
    message,
    documentPath: documentPath ?? null,
    markdownBytes: typeof markdown === 'string' ? byteLength(markdown) : null,
  });
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}
